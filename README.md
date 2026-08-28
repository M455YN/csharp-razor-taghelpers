# C# Razor Tag Helper Support

**C# Razor Tag Helper Support** is a Visual Studio Code extension that
extends the official C# extension with additional support for **custom
Razor Tag Helpers** in Razor views (`.cshtml` / `.razor`).

The extension scans C# projects to detect Tag Helper classes and
provides improved editor assistance when working with them.

------------------------------------------------------------------------

## Features

### Automatic Tag Helper Discovery

-   Scans `.cs` files in the current workspace
-   Detects classes that implement Razor Tag Helpers
-   Resolves tag names from `HtmlTargetElement` attributes
-   Extracts public properties to determine available attributes

### Tag Name IntelliSense

-   Provides suggestions for detected Tag Helpers while typing HTML tags
    in Razor views
-   Integrates with the IntelliSense provided by the official C#
    extension

### Attribute IntelliSense

-   Suggests attributes that belong to the detected Tag Helper
-   Filters attribute suggestions based on the current tag
-   Inserts attributes using snippets with the cursor positioned inside
    quotes

### Hover Documentation

-   Displays documentation for Tag Helpers and their attributes
-   Uses XML documentation comments (`/// <summary>`) from the C# source
    code
-   Shows helpful tooltips directly in Razor files

### Tag Helper Folding

-   Adds fold markers for discovered Tag Helper elements in `.cshtml` /
    `.razor` files
-   Collapses multi-line opening tags (typical for a `<grid>` whose
    `select` attribute holds a large SQL string)
-   Collapses matching open/close Tag Helper pairs, including nesting
-   Ignores markup that appears inside C# verbatim strings, quoted
    attributes, and comments
-   Command **C# Razor Tag Helper Support: Fold All Tag Helpers** folds
    every Tag Helper in the current file
-   Multi-line attributes (especially `select` / `lookup-sql` with SQL)
    get their own fold, so the query can be collapsed without hiding the
    rest of the tag
-   Can be turned off with `csharpRazorTagHelpers.enableFolding`

### Select Attribute Value

-   Command **C# Razor Tag Helper Support: Select Attribute Value**
    selects only the inner value of the attribute under the cursor
    (the SQL inside `select="@(@" ... ")"`, not the whole `<grid>`)
-   Also available from the editor **context menu** (right-click) in
    `.cshtml` / `.razor` files
-   If the cursor is on the tag name or between attributes, the
    `select` attribute is used when present
-   **Expand Selection** (`Shift+Alt+Right` / `Alt+Shift+Right`) grows
    from the SQL, to the whole attribute, to the whole Tag Helper

------------------------------------------------------------------------

## How It Works

1.  The extension scans the workspace for `.cs` files.
2.  Tag Helper classes are detected automatically.
3.  Tag names and attributes are extracted from the C# code.
4.  IntelliSense suggestions are provided inside Razor views.

------------------------------------------------------------------------

## Supported Files

-   `.cshtml`
-   `.razor`
-   `.cs` (for Tag Helper detection)

------------------------------------------------------------------------

## Requirements

-   Visual Studio Code

------------------------------------------------------------------------

## License

MIT