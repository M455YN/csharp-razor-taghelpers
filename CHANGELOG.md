# Changelog

All notable changes to the **C# Razor Tag Helper Support** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.0.2...v1.0.5
[1.0.2]: https://github.com/M455YN/csharp-razor-taghelpers/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/M455YN/csharp-razor-taghelpers/releases/tag/v1.0.0
