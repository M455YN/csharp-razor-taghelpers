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
-   The official **C# extension** installed

------------------------------------------------------------------------

## License

MIT