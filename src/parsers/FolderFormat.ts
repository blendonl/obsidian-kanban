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
        titleRaw: content,
        checked: checkChar === 'x',
        titleSearch: content,
        titleSearchRaw: content,
        metadata: {},
        parent_id: null,
      },
    };

    return item as Item;
  }

  updateItemContent(item: Item, content: string): Item {
    const updated = { ...item };
    updated.data = {
      ...updated.data,
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
    // Check if there are any column folders (any folders at board level)
    const children = boardFolder.children;
    console.log('[FolderFormat] Board folder children count:', children.length);
    
    for (const child of children) {
      console.log('[FolderFormat] Examining child:', child.path, 'type:', child instanceof TFolder ? 'folder' : 'file');
      if (child instanceof TFolder) {
        // Any folder at board level can be a column (even if empty)
        console.log('[FolderFormat] Found column folder:', child.name);
        return true;
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

    // Find all column folders (any folder at board level, including empty ones)
    const columnFolders = boardFolder.children.filter((child): child is TFolder => {
      return child instanceof TFolder;
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
          console.log('[FolderFormat] Item loaded:', item.data.titleRaw);
          lane.children.push(item);
        }
      } catch (error) {
        console.warn(`[FolderFormat] Failed to load item file: ${itemFile.path}`, error);
      }
    }

    // Sort items by filename or add ordering metadata
    lane.children.sort((a: Item, b: Item) => a.data.titleRaw.localeCompare(b.data.titleRaw));

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
          parent_id: frontmatter.parent_id || null,
        },
      };

      return item as Item;
    } catch (error) {
      console.warn(`Failed to parse item file: ${itemFile.path}`, error);
      return null;
    }
  }

  private saveBoardStructure(board: Board): string {
    console.log('[FolderFormat] saveBoardStructure called, saving items to disk');
    
    // Save the board metadata to board.md
    const boardSettings = board.data.settings;
    const frontmatter = board.data.frontmatter;
    
    let content = '---\n';
    content += stringifyYaml({ [frontmatterKey]: 'board', ...frontmatter });
    content += '---\n\n';
    content += '# Board\n\n';
    content += 'This board uses folder structure for columns and items.\n\n';
    content += 'Each folder represents a column, and each .md file in the folder represents an item.\n';
    
    // Save all items to their correct folders
    this.saveAllItemsToFolders(board).catch(error => {
      console.error('[FolderFormat] Failed to save items to folders:', error);
      this.stateManager.setError(error);
    });
    
    return content;
  }

  // Helper method to save all items to their correct folders
  private async saveAllItemsToFolders(board: Board): Promise<void> {
    console.log('[FolderFormat] saveAllItemsToFolders called');
    
    // Track which files exist in each column folder
    const existingFiles = new Map<string, Set<string>>();
    
    // Process each lane (column)
    for (const lane of board.children) {
      const columnName = lane.data.title;
      console.log(`[FolderFormat] Processing column: ${columnName} with ${lane.children.length} items`);
      
      // Track which files should exist in this column
      const expectedFiles = new Set<string>();
      
      // Save each item in this column
      for (const item of lane.children) {
        try {
          await this.saveItemToCorrectFolder(item, columnName);
          
          // Track the expected file
          if (item.data.metadata.file && item.data.metadata.file instanceof TFile) {
            expectedFiles.add(item.data.metadata.file.name);
          }
        } catch (error) {
          console.error(`[FolderFormat] Failed to save item "${item.data.titleRaw}" to column "${columnName}":`, error);
        }
      }
      
      // Clean up files that are no longer in this column
      await this.cleanupColumnFolder(columnName, expectedFiles);
    }
    
    console.log('[FolderFormat] saveAllItemsToFolders completed');
  }

  // Helper method to save an item to the correct folder (handles moves)
  private async saveItemToCorrectFolder(item: Item, newColumnName: string): Promise<void> {
    console.log(`[FolderFormat] saveItemToCorrectFolder: "${item.data.titleRaw}" to column "${newColumnName}"`);
    
    const boardFolder = this.getBoardFolder();
    if (!boardFolder) {
      throw new Error('Board folder not found');
    }

    // If item has an existing file, we need to move it
    if (item.data.metadata.file && item.data.metadata.file instanceof TFile) {
      const existingFile = item.data.metadata.file;
      const currentColumnName = existingFile.parent?.name;
      
      console.log(`[FolderFormat] Item has existing file: ${existingFile.path}, current column: ${currentColumnName}`);
      
      // If the item is already in the correct column, just update its content
      if (currentColumnName === newColumnName) {
        console.log(`[FolderFormat] Item already in correct column, updating content`);
        await this.updateItemFileContent(item, existingFile);
        return;
      }
      
      // Otherwise, move the file to the new column
      await this.moveItemToNewColumn(item, existingFile, newColumnName);
    } else {
      // Create a new file for this item
      await this.createNewItemFile(item, newColumnName);
    }
  }

  // Helper method to clean up files that are no longer in a column
  private async cleanupColumnFolder(columnName: string, expectedFiles: Set<string>): Promise<void> {
    console.log(`[FolderFormat] cleanupColumnFolder: ${columnName}`);
    
    const boardFolder = this.getBoardFolder();
    if (!boardFolder) return;
    
    const columnFolder = boardFolder.children.find((child): child is TFolder => 
      child instanceof TFolder && child.name === columnName
    );
    
    if (!columnFolder) return;
    
    // Find files that are in the folder but not expected
    const filesToRemove: TFile[] = [];
    for (const child of columnFolder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        if (!expectedFiles.has(child.name)) {
          filesToRemove.push(child);
        }
      }
    }
    
    // Remove orphaned files (these were moved to other columns)
    for (const file of filesToRemove) {
      console.log(`[FolderFormat] Removing orphaned file: ${file.path}`);
      try {
        await this.stateManager.app.vault.delete(file);
      } catch (error) {
        console.warn(`[FolderFormat] Failed to delete orphaned file ${file.path}:`, error);
      }
    }
  }

  // Helper method to move an item to a new column
  private async moveItemToNewColumn(item: Item, existingFile: TFile, newColumnName: string): Promise<void> {
    console.log(`[FolderFormat] Moving item from ${existingFile.path} to column ${newColumnName}`);
    
    const boardFolder = this.getBoardFolder();
    if (!boardFolder) {
      throw new Error('Board folder not found');
    }
    
    // Find or create the target column folder
    let targetColumnFolder = boardFolder.children.find((child): child is TFolder => 
      child instanceof TFolder && child.name === newColumnName
    );
    
    if (!targetColumnFolder) {
      console.log(`[FolderFormat] Creating new column folder: ${newColumnName}`);
      targetColumnFolder = await this.stateManager.app.vault.createFolder(
        `${boardFolder.path}/${newColumnName}`
      );
    }
    
    // Create new path for the file
    const newPath = `${targetColumnFolder.path}/${existingFile.name}`;
    
    // Check if a file with the same name already exists in the target folder
    const existingTargetFile = this.stateManager.app.vault.getAbstractFileByPath(newPath);
    if (existingTargetFile && existingTargetFile !== existingFile) {
      // Generate a unique filename
      const baseName = existingFile.basename;
      const extension = existingFile.extension;
      let counter = 1;
      let uniquePath = `${targetColumnFolder.path}/${baseName}_${counter}.${extension}`;
      
      while (this.stateManager.app.vault.getAbstractFileByPath(uniquePath)) {
        counter++;
        uniquePath = `${targetColumnFolder.path}/${baseName}_${counter}.${extension}`;
      }
      
      console.log(`[FolderFormat] Target file exists, using unique name: ${uniquePath}`);
      await this.stateManager.app.fileManager.renameFile(existingFile, uniquePath);
      // Update the item metadata to point to the new file
      const newFile = this.stateManager.app.vault.getAbstractFileByPath(uniquePath) as TFile;
      item.data.metadata.file = newFile;
    } else {
      // Move the file
      console.log(`[FolderFormat] Renaming file from ${existingFile.path} to ${newPath}`);
      await this.stateManager.app.fileManager.renameFile(existingFile, newPath);
      // Update the item metadata to point to the moved file
      const movedFile = this.stateManager.app.vault.getAbstractFileByPath(newPath) as TFile;
      item.data.metadata.file = movedFile;
    }
    
    // Update the file content with current item data
    const currentFile = item.data.metadata.file as TFile;
    await this.updateItemFileContent(item, currentFile);
  }

  // Helper method to create a new item file
  private async createNewItemFile(item: Item, columnName: string): Promise<void> {
    console.log(`[FolderFormat] Creating new item file for "${item.data.titleRaw}" in column "${columnName}"`);
    
    const boardFolder = this.getBoardFolder();
    if (!boardFolder) {
      throw new Error('Board folder not found');
    }
    
    // Find or create the column folder
    let columnFolder = boardFolder.children.find((child): child is TFolder => 
      child instanceof TFolder && child.name === columnName
    );
    
    if (!columnFolder) {
      console.log(`[FolderFormat] Creating new column folder: ${columnName}`);
      columnFolder = await this.stateManager.app.vault.createFolder(
        `${boardFolder.path}/${columnName}`
      );
    }
    
    // Create filename from title, sanitized for filesystem
    const sanitizedTitle = item.data.titleRaw.replace(/[^a-zA-Z0-9\s-_]/g, '').trim();
    let filename = `${sanitizedTitle || 'untitled'}.md`;
    let filePath = `${columnFolder.path}/${filename}`;
    
    // Ensure unique filename
    let counter = 1;
    while (this.stateManager.app.vault.getAbstractFileByPath(filePath)) {
      const baseName = sanitizedTitle || 'untitled';
      filename = `${baseName}_${counter}.md`;
      filePath = `${columnFolder.path}/${filename}`;
      counter++;
    }
    
    // Create file content
    const fileContent = this.generateItemFileContent(item);
    
    // Create the file
    console.log(`[FolderFormat] Creating file: ${filePath}`);
    const newFile = await this.stateManager.app.vault.create(filePath, fileContent);
    
    // Update item metadata to reference the new file
    item.data.metadata.file = newFile;
  }

  // Helper method to update an existing item file's content
  private async updateItemFileContent(item: Item, file: TFile): Promise<void> {
    const newContent = this.generateItemFileContent(item);
    console.log(`[FolderFormat] Updating content for file: ${file.path}`);
    await this.stateManager.app.vault.modify(file, newContent);
  }

  // Helper method to generate file content for an item
  private generateItemFileContent(item: Item): string {
    const frontmatter: Record<string, any> = {
      ...item.data.metadata,
    };
    
    // Set completion status
    if (item.data.checkChar === 'x') {
      frontmatter.completed = true;
    } else {
      delete frontmatter.completed;
    }
    
    // Add required properties
    frontmatter.parent_id = item.data.parent_id || null;
    frontmatter.aliases = frontmatter.aliases || [];
    frontmatter.tags = frontmatter.tags || [];
    
    // Set id to filename (without extension) if item has a file
    if (item.data.metadata.file && item.data.metadata.file instanceof TFile) {
      frontmatter.id = item.data.metadata.file.basename;
    } else {
      // For new items, we'll need to determine the filename first
      const sanitizedTitle = item.data.titleRaw.replace(/[^a-zA-Z0-9\s-_]/g, '').trim();
      frontmatter.id = sanitizedTitle || 'untitled';
    }
    
    // Remove the file reference from frontmatter to avoid circular reference
    delete frontmatter.file;
    
    let fileContent = '---\n';
    fileContent += stringifyYaml(frontmatter);
    fileContent += '---\n\n';
    
    return fileContent;
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
      const sanitizedTitle = item.data.titleRaw.replace(/[^a-zA-Z0-9\s-_]/g, '').trim();
      filename = `${sanitizedTitle || 'untitled'}.md`;
    }

    const filePath = `${columnFolder.path}/${filename}`;

    // Create file content
    const frontmatter: Record<string, any> = {
      ...item.data.metadata,
    };

    // Set completion status
    if (item.data.checkChar === 'x') {
      frontmatter.completed = true;
    }

    // Add required properties
    frontmatter.parent_id = item.data.parent_id || null;
    frontmatter.aliases = frontmatter.aliases || [];
    frontmatter.tags = frontmatter.tags || [];
    
    // Set id to filename (without extension)
    const filenameWithoutExt = filename.replace(/\.md$/, '');
    frontmatter.id = filenameWithoutExt;

    // Remove the file reference from frontmatter to avoid circular reference
    delete frontmatter.file;

    let fileContent = '---\n';
    fileContent += stringifyYaml(frontmatter);
    fileContent += '---\n\n';

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