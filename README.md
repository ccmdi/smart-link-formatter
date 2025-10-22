# Smart Link Formatter
A plugin for Obsidian that automatically formats pasted links with metadata.

It has explicit support for:
* YouTube
* Twitter/X
* Reddit
* YouTube Music
* GitHub
* Image links

## Features
- Automatically formats pasted links
- Supports custom formatting for all clients, as well as regular links
- Blacklist domains to prevent automatic formatting
- Toggle auto-linking on/off

## Formatting
Variables are replaced dynamically by the plugin. The first instance of square brackets `[]` will be a hyperlink for the clipboard content.

For default links, the following variables are available:

- `{title}` - Page title
- `{url}` - The URL of the page

Example format: `[{title}]`

If you need to format a date (e.g. `upload_date`), you can use moment.js date formats: `{upload_date|MMMM Do, YYYY}`

### Custom Formatting

Clients in the plugin have unique variables you can capture. For instance, when pasting a **YouTube** link, the following variables are available for formatting:

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

Other clients follow similar patterns, and their variables can be found in the plugin settings.