# Changelog

All notable changes to the **C# Razor Tag Helper Support** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.6] - 2026-08-21

### Added

- GitHub Actions release workflow: tagging `v*` packages the VSIX and creates a GitHub Release with notes from the latest changelog entry.

## [1.1.5] - 2026-04-07

### Removed

- Dependency on `C# extension` by Microsoft.

## [1.1.4] - 2026-03-08

### Added

- **Completion on new line:** Attribute suggestions now appear when typing the first character of an attribute on a new line (e.g. after Enter in a multi-line `<grid>`). Trigger characters now include letters (a–z, A–Z), digits (0–9), and hyphen, in addition to `<`, space, `=`, and `"`.
- **Attribute name filtering:** When typing a partial attribute name (e.g. `lay`), the list shows only attributes that start with that prefix (e.g. `layout-template`).

### Changed

- **Regex-only scanning:** The C# Language Server (DocumentSymbol / AST) path has been removed. Tag Helpers are discovered only via regex over `.cs` files. This avoids mixed or typed labels (e.g. `row-number-p : boolean`) from the C# provider; our completions show attribute names without types.
- **Attribute value suggestions:** In attribute value context we suggest only valid values: for enum properties – enum members; for bool – `true`/`false`. For string (or other) attributes we no longer suggest other attribute names inside the value; we return no suggestions there.
- **Completion order:** Our element, attribute, and value items use `sortText` so they sort first in the list (ahead of other providers).

### Removed

- AST-based Tag Helper extraction and delayed “rescan with C# Language Server” on startup.
- Dependency on `vscode.executeDocumentSymbolProvider` for scanning.

## [1.1.2] - 2026-03-07

### Added

- **AST-based parsing:** Tag Helpers are now discovered using the C# Language Server (`DocumentSymbol` tree / Roslyn) when available. Properties are correctly scoped to their class, so attributes are no longer mixed when multiple Tag Helper classes live in one file. Regex-based extraction remains as a fallback when the language server has not yet analyzed a file.
- **Boolean value suggestions:** Attributes whose type is `bool` or `Boolean` (including `System.Boolean`) now get `true` and `false` as value suggestions, in the same way enum properties get their enum members.
- **Auto-open value list after attribute insert:** When you complete an attribute that has value suggestions (bool or enum), the value suggestion list now opens automatically after the snippet is inserted (cursor between the quotes), so you can pick `true`/`false` or an enum value without typing `"` or invoking suggest manually.
- **Delayed rescan on startup:** A second scan runs ~4.5 s after activation so the C# Language Server has time to provide symbols. The first scan may use regex; the second uses AST when the LS is ready. See the Output channel “C# Razor Tag Helper Support” for “(AST)” vs “(regex)” per file.

### Fixed

- Value suggestions (enum or bool) did not appear when the first Tag Helper matching the current tag had no value suggestions for that attribute; the provider now aggregates suggestions from all matching helpers instead of returning early.

## [1.1.1] - 2026-03-06

### Added

- Notification in the bottom-right corner of VS Code when the Tag Helper scan finishes (shows how many Tag Helpers were found).
- Auto-rescan when `.cs` files change: a file watcher triggers a new scan on create, change, or delete of any `.cs` file, with an 800 ms debounce to avoid excessive rescans.

### Changed

- **Performance:** Scan now reads each `.cs` file only once. Previously, the extension did two full passes over all files (one for enums, one for Tag Helpers); now a single read pass builds the enum cache and stores file content in memory, and Tag Helper extraction runs on that cached content with no second disk read.
- **Performance:** `findFiles` now excludes `**/bin/**`, `**/obj/**`, and `**/node_modules/**` in all workspace folders, making the scan significantly faster, especially in multi-root workspaces and large solutions.
- Enum values are collected in one pass and reused in memory during the scan (no separate enum-only file read).

[1.1.1]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.1.0...v1.1.1

## [1.1.0] - 2026-03-05

### Added

- Support for publishing to Visual Studio Marketplace.
- Enum value suggestions: attribute completions for properties whose type is a C# enum now offer enum members as value suggestions (with optional auto-trigger in configuration).
- Configuration option `autoTriggerEnumValueSuggestions` to control whether enum values are suggested automatically when typing inside attribute quotes.

### Changed

- Extension metadata updated for Marketplace (gallery banner, keywords, pricing, author).

---

## [1.0.5] - 2026-03-04

### Added

- Support for Tag Helpers that inherit from other Tag Helpers (e.g. `GridModal : GridTagHelper`).
- After scanning, attributes (and summaries/value suggestions) from base Tag Helper classes are merged into derived classes, so elements like `<grid-modal>` get the same attribute completions as `<grid>` plus any extra attributes defined on the derived class.
- Detection of `[HtmlTargetElement("...")]` for any class (not only names ending with `TagHelper`), so derived helpers with custom element names are correctly discovered.

---

## [1.0.2] - 2026-03-04

### Added

- Option to suppress Tag Helper completions when the cursor is inside a double-quoted string (configuration: `csharpRazorTagHelpers.suppressCompletionsInStrings`, default `true`).
- Detection of C# verbatim strings (`@"..."`, `$@"..."`) so that completions are not shown inside SQL or other verbatim string literals in Razor attributes (e.g. `select="@(@" ... ")">`).

### Fixed

- Wrong autocompletion when more than one Tag Helper was present on the page: attribute suggestions were mixed across different elements (e.g. `<grid>` showed attributes from `tabs-filter-soul`).
- Completions are now filtered strictly by the tag name being edited: typing `<grid` or `<grid ` only shows attributes for the `grid` Tag Helper. No fallback to “all” Tag Helpers when the current tag is identified.
- Correct association of `[HtmlTargetElement("...")]` with the right class when multiple Tag Helpers exist in the same file (element name is bound to the immediately following class declaration).

---

## [1.0.0] - 2026-03-03

### Added

- Initial release of C# Razor Tag Helper Support.
- IntelliSense for custom Razor Tag Helpers in `.cshtml` and `.razor` files:
  - Element name completion after `<`.
  - Attribute name completion for the current tag, with snippet `attribute-name=""`.
- Hover documentation for Tag Helper elements and attributes (from `/// <summary>` in C#).
- Discovery of Tag Helper classes by scanning workspace `.cs` files:
  - Classes ending with `TagHelper` or with `[HtmlTargetElement("...")]`.
  - Element names from the attribute or from kebab-case class name.
  - Public properties with `get; set;` exposed as kebab-case attributes.
- Command **C# Razor Tag Helpers: Refresh** to rescan Tag Helpers manually.
- Output channel **C# Razor Tag Helper Support** for scan progress and results.

[Unreleased]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.0.2...v1.0.5
[1.0.2]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/M455YN/csharp-razor-taghelpers/releases/tag/v1.0.0
