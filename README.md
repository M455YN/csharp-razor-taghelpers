# C# Razor Tag Helpers

C# Razor Tag Helpers is an extension for Visual Studio Code that
**extends the official C# extension** with support for **custom Tag
Helpers** in Razor views (`.cshtml` / `.razor`).

------------------------------------------------------------------------

## Features

### Automatic Tag Helper Detection

-   Scans all `.cs` files in the current workspace
-   Finds classes ending with `TagHelper` (e.g., `GridTagHelper`)
-   Reads `[HtmlTargetElement("grid")]` to determine the tag name
-   Collects public `get; set;` properties as potential attributes

### Tag Name IntelliSense

-   While typing a tag name (e.g., `<gr`), the extension suggests
    available Tag Helpers (`grid`, `frax`, etc.)
-   Suggestions appear alongside those provided by the official C#
    extension

### Attribute IntelliSense

-   After typing a full tag name followed by a space (e.g., `<grid`):
    -   The extension detects that you are inside the `grid` tag
    -   It suggests only attributes belonging to that specific Tag
        Helper (based on its class properties, e.g., `row-number-p`,
        `empty-data-template`, etc.)
-   Selecting an attribute inserts a snippet in the form
    `attribute-name=""` with the cursor placed inside the quotes

### Hover Documentation (Tooltips)

If your C# code contains XML documentation comments
(`/// <summary>...</summary>`):

-   Hovering over the tag name (e.g., `<grid>`) shows the summary from
    the `*TagHelper` class
-   Hovering over an attribute (e.g., `row-number-p`) shows the summary
    from the corresponding property

------------------------------------------------------------------------