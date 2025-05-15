A plugin for Obsidian that automatically formats pasted links with metadata, with explicit support for YouTube.

## Regular Link Formatting

For non-YouTube links, the following variables are available:

- `{title}` - Page title
- `{link}` - The URL of the page

Example format: `[{title}]({link})`

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
- `{thumbnail}` - Currently not supported

Example format: `[{title} by {channel}]({url})`

## Features

- Automatically formats pasted links with metadata
- Supports custom formatting for both YouTube and regular links
- Blacklist domains to prevent automatic formatting
- Toggle auto-linking on/off
- Preserves existing link formatting when pasting inside markdown links or code blocks

## Settings

- **Auto-linking**: Enable/disable automatic link formatting
- **Default link format**: Customize how non-YouTube links are formatted
- **Blacklisted domains**: Comma-separated list of domains to exclude from automatic formatting