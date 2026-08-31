'use strict';

const { simplifyCSharpType } = require('./inlayHints');

/**
 * Convert PascalCase / CamelCase name to kebab-case.
 * Example: "MyButton" -> "my-button", "HTMLInput" -> "html-input"
 */
function pascalToKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** True if the C# type string is bool (e.g. "bool", "Boolean", "System.Boolean"). */
function isBooleanType(typeName) {
  if (!typeName || typeof typeName !== 'string') return false;
  const t = typeName.trim();
  return t === 'bool' || t === 'Boolean' || t.endsWith('.Boolean');
}

/**
 * Populate globalEnumValues from raw C# text (regex).
 */
function collectEnumsFromText(text, globalEnumValues) {
  const enumRegex = /public\s+enum\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let enumMatch;
  while ((enumMatch = enumRegex.exec(text)) !== null) {
    const enumName = enumMatch[1];
    const body = enumMatch[2];
    const values = [];
    const memberRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:=.*?(?:,|\}|\s*$))/g;
    let m2;
    while ((m2 = memberRegex.exec(body)) !== null) {
      const memberName = m2[1];
      if (memberName === 'public' || memberName === 'enum') continue;
      values.push(memberName);
    }
    if (values.length) {
      globalEnumValues[enumName] = values;
    }
  }
}

/**
 * Regex-based TagHelper extraction from C# source text.
 * @param {{ fsPath: string }} uri
 * @param {Record<string, string[]>} globalEnumValues
 * @param {{ log?: (message: string) => void }|null} [options]
 */
function parseTagHelpersWithRegex(uri, text, globalEnumValues, options) {
  const lines = text.split(/\r?\n/);
  const result = [];
  const log = options && options.log;

  // Pass 1 – collect /// <summary> for classes and properties
  const classSummaries = {};
  const propertySummaries = {};
  let pendingSummary = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const summaryStart = line.match(/\/\/\/\s*<summary>\s*(.*)?/);
    if (summaryStart) {
      const summaryLines = [];
      if (summaryStart[1]) summaryLines.push(summaryStart[1].trim());
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.match(/\/\/\/\s*<\/summary>/)) break;
        const mid = l.match(/\/\/\/\s*(.*)/);
        if (mid) summaryLines.push(mid[1].trim());
      }
      pendingSummary = summaryLines.join(' ').trim();
      i = j;
      continue;
    }
    if (pendingSummary) {
      const classMatch = line.match(/class\s+(\w+TagHelper)\b/);
      if (classMatch) {
        classSummaries[classMatch[1]] = pendingSummary;
        pendingSummary = null;
        continue;
      }
      const propMatch = line.match(
        /public\s+[\w<>\.\?\[\],\s]+\s+(\w+)\s*\{\s*get;\s*set;\s*\}/
      );
      if (propMatch) {
        propertySummaries[propMatch[1]] = pendingSummary;
        pendingSummary = null;
        continue;
      }
    }
  }

  // Pass 2 – map [HtmlTargetElement("...")] to the class below it
  const classElementNames = {};
  const classParentTags = {};
  let pendingElementName = null;
  let pendingParentTag = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const attrMatch = line.match(/\[\s*HtmlTargetElement\s*\(\s*"(.*?)"([^\]\n]*)/);
    if (attrMatch) {
      pendingElementName = attrMatch[1];
      const parent = attrMatch[2] && attrMatch[2].match(/ParentTag\s*=\s*"(.*?)"/);
      pendingParentTag = parent ? parent[1] : null;
      continue;
    }
    const classDeclMatch = line.match(/class\s+(\w+)\b/);
    if (classDeclMatch) {
      const cName = classDeclMatch[1];
      if (pendingElementName) {
        classElementNames[cName] = pendingElementName;
        classParentTags[cName] = pendingParentTag;
        pendingElementName = null;
        pendingParentTag = null;
      }
    }
  }

  // Pass 3 – extract classes and their properties
  const classRegex = /class\s+(\w+)\s*(?::\s*([\w<>,\s]+))?/g;
  let match;
  while ((match = classRegex.exec(text)) !== null) {
    const className = match[1];
    const baseClause = match[2] || '';
    const baseClassName = baseClause.split(/[<,\s]/).filter(Boolean)[0] || '';

    const hasHtmlTarget = !!classElementNames[className];
    const looksLikeTagHelper =
      /TagHelper\b/.test(className) || /TagHelper\b/.test(baseClause);

    if (!hasHtmlTarget && !looksLikeTagHelper) continue;

    let elementName = classElementNames[className] || '';
    const baseName = className.replace(/TagHelper$/, '');
    if (!elementName) {
      if (!baseName) continue;
      elementName = pascalToKebab(baseName);
    }

    const attributes = [];
    const attributeSummaries = {};
    const attributeTypes = {};
    const attributePropertyNames = {};
    const propRegex =
      /public\s+([\w<>\.\?\[\],\s]+)\s+(\w+)\s*\{\s*get;\s*set;\s*\}/g;
    const valueSuggestions = {};
    let propMatch;
    while ((propMatch = propRegex.exec(text)) !== null) {
      const propType = (propMatch[1] || '').trim();
      const propName = propMatch[2];
      const kebabName = pascalToKebab(propName);
      attributes.push(kebabName);
      attributePropertyNames[kebabName] = propName;
      if (propertySummaries[propName]) {
        attributeSummaries[kebabName] = propertySummaries[propName];
      }
      if (propType) {
        const simplified = simplifyCSharpType(propType);
        if (simplified) {
          attributeTypes[kebabName] = simplified;
        }
        const simpleType = propType
          .replace(/\?$/, '')
          .split(/[<>\s]/)
          .filter(Boolean)
          .pop();
        if (isBooleanType(simpleType)) {
          valueSuggestions[kebabName] = ['true', 'false'];
        } else if (simpleType && globalEnumValues[simpleType]) {
          valueSuggestions[kebabName] = globalEnumValues[simpleType];
        }
      }
    }

    result.push({
      className,
      baseClassName: baseClassName || null,
      elementName,
      attributeName: elementName,
      file: uri.fsPath,
      attributes,
      parentTag: classParentTags[className] || null,
      summary: classSummaries[className],
      attributeSummaries,
      attributeTypes,
      attributePropertyNames,
      valueSuggestions
    });

    if (log) {
      log(
        `[C# Razor Tag Helper Support] Found TagHelper (regex): ${className} -> <${elementName}> (${attributes.length} attributes) in ${uri.fsPath}`
      );
    }
  }

  return result;
}

module.exports = {
  pascalToKebab,
  isBooleanType,
  collectEnumsFromText,
  parseTagHelpersWithRegex
};
