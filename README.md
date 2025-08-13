# Obsidian Kanban Fork

A fork of the [original Obsidian Kanban Plugin](https://github.com/mgmeyers/obsidian-kanban) with support for folder-based board structure.

## What's Changed

This fork introduces a new folder-based structure for Kanban boards:

### Folder Structure
Instead of storing all columns and items in a single markdown file, you can now organize your boards using folders:

```
MyBoard/
├── board.md          # Board metadata and settings
├── Todo/             # Column folder
│   ├── task1.md      # Individual task file
│   ├── task2.md
│   └── task3.md
├── In Progress/      # Another column folder
│   ├── task4.md
│   └── task5.md
└── Done/             # Third column folder
    └── task6.md
```

### How It Works
- **Board metadata**: Stored in `board.md` with frontmatter containing board settings
- **Columns**: Represented by folders - each folder name becomes a column title
- **Tasks/Items**: Individual `.md` files within column folders
- **Task metadata**: Stored in each task file's frontmatter (completion status, dates, etc.)

### Automatic Detection
The plugin automatically detects which structure to use:
- If folder structure exists (folders containing `.md` files), it uses the new folder format
- Otherwise, it falls back to the original single-file format

## Installation

1. Download the latest release
2. Extract the files to your Obsidian plugins folder: `VaultFolder/.obsidian/plugins/obsidian-kanban/`
3. Enable the plugin in Obsidian settings

## Usage

### Creating a Folder-Based Board

1. Create a new folder for your board
2. Inside the folder, create a `board.md` file with kanban frontmatter:
   ```yaml
   ---
   kanban-plugin: board
   ---
   
   # My Board
   ```
3. Create subfolders for your columns (e.g., `Todo`, `In Progress`, `Done`)
4. Add `.md` files in each folder for your tasks:
   ```yaml
   ---
   title: "My Task"
   completed: false
   ---
   
   # My Task
   
   Task description here...
   ```

### Task File Format

Each task file can contain:
- `title`: Task title (optional, uses filename if not provided)
- `completed`: Boolean indicating if task is done
- `status`: Alternative completion field (e.g., "completed")
- `done`: Another alternative completion field
- Any other metadata you want to track

### Opening Boards

- Open the `board.md` file and switch to Kanban view
- The plugin will automatically load columns from folders and tasks from files
- Changes are saved back to individual files

## Original Kanban Plugin

This fork is based on the excellent work by [mgmeyers](https://github.com/mgmeyers). For the original plugin documentation and features, visit the [original repository](https://github.com/mgmeyers/obsidian-kanban).

## License

MIT License - same as the original project.