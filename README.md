A plugin for Obsidian that automatically formats pasted links with metadata, with explicit support for YouTube.

# Formatting
Variables are replaced dynamically by the plugin. The first instance of square brackets `[]` will be a hyperlink for the clipboard content.

For non-YouTube links, the following variables are available:

- `{title}` - Page title
- `{url}` - The URL of the page

Example format: `[{title}]`

## YouTube Link Formatting

When pasting a YouTube link, the following variables are available for formatting:

- `{title}` - Video title
- `{channel}` - Channel name
- `{uploader}` - Uploader name (which can sometimes differ from channel)
- `{duration}` - Length of the video
- `{views}` - Number of views
- `{upload_date}` - When the video was uploaded
- `{description}` - Video description
- `{url}` - The URL of the video
- `{timestamp}` - For timestamped links (formats as @HH:MM:SS or @MM:SS)

Example format: `[{title}] by {channel}`

# Features

- Automatically formats pasted links
- Supports custom formatting for both YouTube and regular links
- Blacklist domains to prevent automatic formatting
- Toggle auto-linking on/off

# Roadmap
- [ ] Conditional formatting
- [ ] Expanded services
- [ ] General robustness