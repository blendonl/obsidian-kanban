import { TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';
import { StateManager } from 'src/StateManager';
import { Board, Item, Lane, BoardTemplate, LaneTemplate, ItemTemplate } from 'src/components/types';
import { generateInstanceId } from 'src/components/helpers';

import { BaseFormat, frontmatterKey } from './common';
import { hydrateBoard } from './helpers/hydrateBoard';
import { parseMarkdown, parseFragment } from './parseMarkdown';
import { extractInlineFields } from './helpers/inlineMetadata';

export class FolderFormat implements BaseFormat {
  stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  newItem(content: string, checkChar: string, forceEdit?: boolean): Item {
    const id = generateInstanceId();
    const item = {
      ...ItemTemplate,
      id,
      children: [] as any[],
      data: {
        checkChar,
        title: content,
        titleRaw: content,
        metadata: {},
      },
    };

    return item as Item;
  }

  updateItemContent(item: Item, content: string): Item {
    const updated = { ...item };
    updated.data = {
      ...updated.data,
      title: content,
      titleRaw: content,
    };
    return updated;
  }

  boardToMd(board: Board): string {
    // For folder structure, we need to save to multiple files
    // This method should coordinate saving the board structure
    return this.saveBoardStructure(board);
  }

  mdToBoard(md: string): Board {
    console.log('[FolderFormat] mdToBoard called, md length:', md.length);
    // Parse board metadata from board.md first
    const { frontmatter, settings } = parseMarkdown(this.stateManager, md);
    
    // For folder format, we need to load asynchronously
    // This is a synchronous interface, so we'll need to handle this differently
    // For now, return a placeholder and trigger async load
    const board = {
      ...BoardTemplate,
      id: this.stateManager.file.path,
      children: [] as any[],
      data: {
        settings: settings || {},
        frontmatter: frontmatter || {},
        errors: [] as any[],
        archive: [],
        isSearching: false,
      },
    };

    console.log('[FolderFormat] Starting async board loading');
    // Trigger async loading
    this.loadBoardAsync(md).then(loadedBoard => {
      console.log('[FolderFormat] Async loading completed, columns:', loadedBoard.children.length);
      // Update the state manager with the loaded board
      if (this.stateManager.state) {
        this.stateManager.setState(loadedBoard, false);
      }
    }).catch(error => {
      console.error('[FolderFormat] Failed to load folder structure:', error);
      this.stateManager.setError(error);
    });

    console.log('[FolderFormat] Returning placeholder board');
    return board as Board;
  }

  reparseBoard(): Board {
    // Similar approach for reparsing
    const board = {
      ...BoardTemplate,
      id: generateInstanceId(),
      children: [] as any[],
      data: {
        settings: {},
        frontmatter: {},
        errors: [] as any[],
      },
    };

    // Trigger async reloading
    this.reloadBoardAsync().then(loadedBoard => {
      if (this.stateManager.state) {
        this.stateManager.setState(loadedBoard, false);
      }
    }).catch(error => {
      console.error('Failed to reparse folder structure:', error);
      this.stateManager.setError(error);
    });

    return board as Board;
  }

  private async loadBoardAsync(md: string): Promise<Board> {
    console.log('[FolderFormat] loadBoardAsync called');
    const boardFolder = this.getBoardFolder();
    console.log('[FolderFormat] Board folder:', boardFolder?.path || 'null');
    
    if (boardFolder) {
      const hasFolderStructure = this.hasFolderStructure(boardFolder);
      console.log('[FolderFormat] Has folder structure:', hasFolderStructure);
      if (hasFolderStructure) {
        console.log('[FolderFormat] Loading from folder structure');
        return this.loadFromFolderStructure(boardFolder, md);
      }
    }
    console.log('[FolderFormat] No folder structure found');
    throw new Error('No folder structure found for board');
  }

  private async reloadBoardAsync(): Promise<Board> {
    const boardFolder = this.getBoardFolder();
    if (boardFolder && this.hasFolderStructure(boardFolder)) {
      // Re-read the board.md file for board metadata
      const boardFile = this.stateManager.file;
      const content = await this.stateManager.app.vault.read(boardFile);
      return this.loadFromFolderStructure(boardFolder, content);
    }
    throw new Error('Cannot reparse: no folder structure found');
  }

  private getBoardFolder(): TFolder | null {
    const boardFile = this.stateManager.file;
    return boardFile.parent;
  }

  private hasFolderStructure(boardFolder: TFolder): boolean {
    console.log('[FolderFormat] Checking folder structure for:', boardFolder.path);
    // Check if there are any column folders (folders containing .md files)
    const children = boardFolder.children;
    console.log('[FolderFormat] Board folder children count:', children.length);
    
    for (const child of children) {
      console.log('[FolderFormat] Examining child:', child.path, 'type:', child instanceof TFolder ? 'folder' : 'file');
      if (child instanceof TFolder) {
        // Check if this folder contains any .md files (potential items)
        const hasMarkdownFiles = child.children.some(f => {
          const isMarkdown = f instanceof TFile && f.extension === 'md';
          if (isMarkdown) {
            console.log('[FolderFormat] Found markdown file:', f.path);
          }
          return isMarkdown;
        });
        
        console.log('[FolderFormat] Folder', child.name, 'has markdown files:', hasMarkdownFiles);
        if (hasMarkdownFiles) {
          return true;
        }
      }
    }
    
    console.log('[FolderFormat] No folder structure found');
    return false;
  }

  private async loadFromFolderStructure(boardFolder: TFolder, boardMd: string): Promise<Board> {
    console.log('[FolderFormat] loadFromFolderStructure called');
    // Parse board metadata from board.md
    const { frontmatter, settings } = parseMarkdown(this.stateManager, boardMd);
    console.log('[FolderFormat] Parsed frontmatter and settings');
    
    const board = {
      ...BoardTemplate,
      id: generateInstanceId(),
      children: [] as any[],
      data: {
        settings: settings,
        frontmatter: frontmatter,
        errors: [] as any[],
      },
    };

    // Find all column folders (folders that contain .md files)
    const columnFolders = boardFolder.children.filter((child): child is TFolder => {
      if (!(child instanceof TFolder)) return false;
      
      // Check if this folder contains .md files
      return child.children.some(f => f instanceof TFile && f.extension === 'md');
    });

    console.log('[FolderFormat] Found column folders:', columnFolders.map(f => f.name));

    // Load each column
    for (const columnFolder of columnFolders) {
      console.log('[FolderFormat] Loading column:', columnFolder.name);
      const lane = await this.loadColumn(columnFolder);
      if (lane) {
        console.log('[FolderFormat] Column loaded with items:', lane.children.length);
        board.children.push(lane);
      }
    }

    // Sort columns by folder name
    board.children.sort((a: Lane, b: Lane) => a.data.title.localeCompare(b.data.title));

    console.log('[FolderFormat] Board loaded with columns:', board.children.length);
    return hydrateBoard(this.stateManager, board as Board);
  }

  private async loadColumn(columnFolder: TFolder): Promise<Lane | null> {
    console.log('[FolderFormat] Loading column:', columnFolder.name);
    // Column title is the folder name
    const columnTitle = columnFolder.name;

    const lane = {
      ...LaneTemplate,
      id: generateInstanceId(),
      children: [] as any[],
      data: {
        title: columnTitle,
      },
    };

    // Load all .md files directly in this folder as items
    const itemFiles = columnFolder.children.filter((f): f is TFile => 
      f instanceof TFile && f.extension === 'md'
    );

    console.log('[FolderFormat] Found item files in column:', itemFiles.map(f => f.name));

    for (const itemFile of itemFiles) {
      try {
        console.log('[FolderFormat] Loading item file:', itemFile.path);
        const content = await this.stateManager.app.vault.read(itemFile);
        const item = await this.loadItemFromFile(itemFile, content);
        if (item) {
          console.log('[FolderFormat] Item loaded:', item.data.title);
          lane.children.push(item);
        }
      } catch (error) {
        console.warn(`[FolderFormat] Failed to load item file: ${itemFile.path}`, error);
      }
    }

    // Sort items by filename or add ordering metadata
    lane.children.sort((a: Item, b: Item) => a.data.title.localeCompare(b.data.title));

    console.log('[FolderFormat] Column loaded with', lane.children.length, 'items');
    return lane as Lane;
  }

  private async loadItemFromFile(itemFile: TFile, content: string): Promise<Item | null> {
    try {
      const { frontmatter, ast } = parseMarkdown(this.stateManager, content);
      
      // Extract title from frontmatter or first heading or filename
      let title = frontmatter.title || itemFile.basename;
      
      // If no title in frontmatter, try to extract from content
      if (!frontmatter.title && ast.children.length > 0) {
        const firstChild = ast.children[0];
        if (firstChild.type === 'heading') {
          title = firstChild.children.map(child => 
            child.type === 'text' ? child.value : ''
          ).join('');
        }
      }

      // Extract task completion status
      const isCompleted = frontmatter.completed === true || 
                          frontmatter.status === 'completed' ||
                          frontmatter.done === true;

      const item = {
        ...ItemTemplate,
        id: generateInstanceId(),
        children: [] as any[],
        data: {
          checked: isCompleted,
          checkChar: isCompleted ? 'x' : ' ',
          title: title,
          titleRaw: title,
          titleSearch: title.toLowerCase(),
          titleSearchRaw: title.toLowerCase(),
          metadata: {
            ...frontmatter,
            file: itemFile,
          },
        },
      };

      return item as Item;
    } catch (error) {
      console.warn(`Failed to parse item file: ${itemFile.path}`, error);
      return null;
    }
  }

  private saveBoardStructure(board: Board): string {
    // Save the board metadata to board.md
    const boardSettings = board.data.settings;
    const frontmatter = board.data.frontmatter;
    
    let content = '---\n';
    content += stringifyYaml({ [frontmatterKey]: 'board', ...frontmatter });
    content += '---\n\n';
    content += '# Board\n\n';
    content += 'This board uses folder structure for columns and items.\n\n';
    content += 'Each folder represents a column, and each .md file in the folder represents an item.\n';
    
    // TODO: Implement saving logic for individual items when they're modified
    // This should update the corresponding .md files in their respective column folders
    
    return content;
  }

  // Helper method to save an item to its file
  async saveItem(item: Item, columnName: string): Promise<void> {
    const boardFolder = this.getBoardFolder();
    if (!boardFolder) {
      throw new Error('Board folder not found');
    }

    // Find or create the column folder
    let columnFolder = boardFolder.children.find((child): child is TFolder => 
      child instanceof TFolder && child.name === columnName
    );

    if (!columnFolder) {
      // Create column folder if it doesn't exist
      columnFolder = await this.stateManager.app.vault.createFolder(
        `${boardFolder.path}/${columnName}`
      );
    }

    // Determine filename - use existing file if item has one, otherwise create new
    let filename: string;
    if (item.data.metadata.file && item.data.metadata.file instanceof TFile) {
      filename = item.data.metadata.file.name;
    } else {
      // Create filename from title, sanitized for filesystem
      const sanitizedTitle = item.data.title.replace(/[^a-zA-Z0-9\s-_]/g, '').trim();
      filename = `${sanitizedTitle || 'untitled'}.md`;
    }

    const filePath = `${columnFolder.path}/${filename}`;

    // Create file content
    const frontmatter: Record<string, any> = {
      ...item.data.metadata,
      title: item.data.title,
    };

    // Set completion status
    if (item.data.checkChar === 'x') {
      frontmatter.completed = true;
    }

    // Remove the file reference from frontmatter to avoid circular reference
    delete frontmatter.file;

    let fileContent = '---\n';
    fileContent += stringifyYaml(frontmatter);
    fileContent += '---\n\n';
    fileContent += `# ${item.data.title}\n\n`;
    
    // Add any additional content if the item has it
    if (item.data.titleRaw !== item.data.title) {
      fileContent += item.data.titleRaw;
    }

    // Save or update the file
    try {
      const existingFile = this.stateManager.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await this.stateManager.app.vault.modify(existingFile, fileContent);
      } else {
        await this.stateManager.app.vault.create(filePath, fileContent);
      }
    } catch (error) {
      console.error(`Failed to save item to ${filePath}:`, error);
      throw error;
    }
  }
}