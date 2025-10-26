import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from 'obsidian';

interface QuickNoteSettings {
	baseFolder: string;
	templatePath: string;
}

const DEFAULT_SETTINGS: QuickNoteSettings = {
	baseFolder: 'Notes',
	templatePath: ''
}

export default class QuickNotePlugin extends Plugin {
	settings: QuickNoteSettings;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon for quick note creation
		this.addRibbonIcon('file-plus', 'Create quick note', () => {
			this.createQuickNote();
		});

		// Add command for note creation
		this.addCommand({
			id: 'create-quick-note',
			name: 'Create quick note',
			callback: () => {
				this.createQuickNote();
			}
		});

		// Add settings tab
		this.addSettingTab(new QuickNoteSettingTab(this.app, this));
	}

	async getPastNoteTitles(): Promise<string[]> {
		const titles = new Set<string>();
		const baseFolder = this.app.vault.getAbstractFileByPath(
			normalizePath(this.settings.baseFolder)
		);

		if (!baseFolder) {
			return [];
		}

		// Regex to match date prefix: YYYY-MM-DD
		const datePattern = /^\d{4}-\d{2}-\d{2}\s+/;

		const extractTitles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					// Extract title by removing date prefix
					const fileName = child.basename;
					const titleMatch = fileName.replace(datePattern, '');
					if (titleMatch && titleMatch !== fileName) {
						// Only add if date prefix was found and removed
						titles.add(titleMatch);
					}
				} else if (child instanceof TFolder) {
					// Recursively search subfolders
					extractTitles(child);
				}
			}
		};

		if (baseFolder instanceof TFolder) {
			extractTitles(baseFolder);
		}

		// Return sorted array for better UX
		return Array.from(titles).sort((a, b) => a.localeCompare(b));
	}

	async createQuickNote() {
		// Get past note titles for autocomplete
		const pastTitles = await this.getPastNoteTitles();

		// Open modal to get note title
		new TitleInputModal(this.app, pastTitles, async (title: string) => {
			try {
				// Get current date in YYYY-MM-DD format
				const now = new Date();
				const dateStr = this.formatDate(now);

				// Create folder path: baseFolder/YYYY/MM/
				const year = now.getFullYear().toString();
				const month = (now.getMonth() + 1).toString().padStart(2, '0');
				const folderPath = normalizePath(`${this.settings.baseFolder}/${year}/${month}`);

				// Create filename: YYYY-MM-DD Title.md
				const fileName = `${dateStr} ${title}.md`;
				const filePath = normalizePath(`${folderPath}/${fileName}`);

				// Check if file already exists
				const existingFile = this.app.vault.getAbstractFileByPath(filePath);
				if (existingFile instanceof TFile) {
					// File exists, open it
					await this.app.workspace.getLeaf().openFile(existingFile);
					new Notice(`Opened existing note: ${title}`);
					return;
				}

				// Ensure folder exists
				await this.ensureFolderExists(folderPath);

				// Get note content (from template or empty)
				const content = await this.getNoteContent();

				// Create the note
				const file = await this.app.vault.create(filePath, content);

				// Open the newly created note
				await this.app.workspace.getLeaf().openFile(file);

				new Notice(`Created note: ${title}`);
			} catch (error) {
				console.error('Error creating quick note:', error);
				new Notice(`Failed to create note: ${error.message}`);
			}
		}).open();
	}

	formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	async ensureFolderExists(folderPath: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	async getNoteContent(): Promise<string> {
		// If template path is configured, try to load it
		if (this.settings.templatePath) {
			const templateFile = this.app.vault.getAbstractFileByPath(
				normalizePath(this.settings.templatePath)
			);

			if (templateFile instanceof TFile) {
				return await this.app.vault.read(templateFile);
			} else {
				console.warn(`Template file not found: ${this.settings.templatePath}`);
			}
		}

		// Return empty content if no template or template not found
		return '';
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TitleInputModal extends Modal {
	onSubmit: (title: string) => void;
	titleInput: HTMLInputElement;
	suggestionsContainer: HTMLDivElement;
	pastTitles: string[];
	filteredSuggestions: string[];
	selectedIndex: number;

	constructor(app: App, pastTitles: string[], onSubmit: (title: string) => void) {
		super(app);
		this.pastTitles = pastTitles;
		this.onSubmit = onSubmit;
		this.filteredSuggestions = [];
		this.selectedIndex = -1;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Create quick note' });

		// Create input container with relative positioning for dropdown
		const inputWrapper = contentEl.createDiv();
		inputWrapper.style.position = 'relative';

		inputWrapper.createEl('label', { text: 'Note title:', cls: 'setting-item-name' });

		this.titleInput = inputWrapper.createEl('input', {
			type: 'text',
			placeholder: 'Enter note title...'
		});
		this.titleInput.style.width = '100%';
		this.titleInput.style.marginTop = '8px';
		this.titleInput.style.padding = '8px';
		this.titleInput.style.boxSizing = 'border-box';

		// Create suggestions dropdown
		this.suggestionsContainer = inputWrapper.createDiv();
		this.suggestionsContainer.style.position = 'absolute';
		this.suggestionsContainer.style.width = '100%';
		this.suggestionsContainer.style.maxHeight = '200px';
		this.suggestionsContainer.style.overflowY = 'auto';
		this.suggestionsContainer.style.backgroundColor = 'var(--background-primary)';
		this.suggestionsContainer.style.border = '1px solid var(--background-modifier-border)';
		this.suggestionsContainer.style.borderRadius = '4px';
		this.suggestionsContainer.style.marginTop = '2px';
		this.suggestionsContainer.style.display = 'none';
		this.suggestionsContainer.style.zIndex = '1000';
		this.suggestionsContainer.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';

		// Input event listener for filtering
		this.titleInput.addEventListener('input', () => {
			this.updateSuggestions();
		});

		// Keyboard navigation
		this.titleInput.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'ArrowDown') {
				evt.preventDefault();
				this.navigateSuggestions(1);
			} else if (evt.key === 'ArrowUp') {
				evt.preventDefault();
				this.navigateSuggestions(-1);
			} else if (evt.key === 'Enter') {
				evt.preventDefault();
				if (this.selectedIndex >= 0 && this.filteredSuggestions.length > 0) {
					this.selectSuggestion(this.filteredSuggestions[this.selectedIndex]);
				} else {
					this.submit();
				}
			} else if (evt.key === 'Escape') {
				evt.preventDefault();
				this.hideSuggestions();
			} else if (evt.key === 'Tab' && this.filteredSuggestions.length > 0) {
				evt.preventDefault();
				this.selectSuggestion(this.filteredSuggestions[0]);
			}
		});

		// Focus input
		this.titleInput.focus();

		// Create button container
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.marginTop = '16px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '8px';

		// Cancel button
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		// Create button
		const createBtn = buttonContainer.createEl('button', {
			text: 'Create',
			cls: 'mod-cta'
		});
		createBtn.addEventListener('click', () => this.submit());
	}

	updateSuggestions() {
		const inputValue = this.titleInput.value.toLowerCase();

		if (!inputValue) {
			this.hideSuggestions();
			return;
		}

		// Filter suggestions based on input
		this.filteredSuggestions = this.pastTitles.filter(title =>
			title.toLowerCase().includes(inputValue)
		);

		if (this.filteredSuggestions.length === 0) {
			this.hideSuggestions();
			return;
		}

		// Clear and rebuild suggestions
		this.suggestionsContainer.empty();
		this.selectedIndex = -1;

		this.filteredSuggestions.forEach((suggestion, index) => {
			const item = this.suggestionsContainer.createDiv();
			item.textContent = suggestion;
			item.style.padding = '8px 12px';
			item.style.cursor = 'pointer';
			item.style.borderBottom = '1px solid var(--background-modifier-border)';

			// Hover effect
			item.addEventListener('mouseenter', () => {
				this.selectedIndex = index;
				this.highlightSelected();
			});

			// Click selection
			item.addEventListener('click', () => {
				this.selectSuggestion(suggestion);
			});
		});

		this.suggestionsContainer.style.display = 'block';
		this.highlightSelected();
	}

	navigateSuggestions(direction: number) {
		if (this.filteredSuggestions.length === 0) return;

		this.selectedIndex += direction;

		// Wrap around
		if (this.selectedIndex < 0) {
			this.selectedIndex = this.filteredSuggestions.length - 1;
		} else if (this.selectedIndex >= this.filteredSuggestions.length) {
			this.selectedIndex = 0;
		}

		this.highlightSelected();
		this.scrollToSelected();
	}

	highlightSelected() {
		const items = this.suggestionsContainer.children;
		for (let i = 0; i < items.length; i++) {
			const item = items[i] as HTMLElement;
			if (i === this.selectedIndex) {
				item.style.backgroundColor = 'var(--background-modifier-hover)';
			} else {
				item.style.backgroundColor = '';
			}
		}
	}

	scrollToSelected() {
		if (this.selectedIndex >= 0) {
			const selectedItem = this.suggestionsContainer.children[this.selectedIndex] as HTMLElement;
			if (selectedItem) {
				selectedItem.scrollIntoView({ block: 'nearest' });
			}
		}
	}

	selectSuggestion(suggestion: string) {
		this.titleInput.value = suggestion;
		this.hideSuggestions();
		this.titleInput.focus();
	}

	hideSuggestions() {
		this.suggestionsContainer.style.display = 'none';
		this.selectedIndex = -1;
	}

	submit() {
		const title = this.titleInput.value.trim();
		if (title) {
			this.onSubmit(title);
			this.close();
		} else {
			new Notice('Please enter a note title');
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class QuickNoteSettingTab extends PluginSettingTab {
	plugin: QuickNotePlugin;

	constructor(app: App, plugin: QuickNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Quick Note Settings' });

		// Base folder setting
		new Setting(containerEl)
			.setName('Base folder')
			.setDesc('Folder where notes will be created (notes will be organized in YYYY/MM/ subfolders)')
			.addText(text => text
				.setPlaceholder('Notes')
				.setValue(this.plugin.settings.baseFolder)
				.onChange(async (value) => {
					this.plugin.settings.baseFolder = value || 'Notes';
					await this.plugin.saveSettings();
				}));

		// Template file setting
		new Setting(containerEl)
			.setName('Template file')
			.setDesc('Optional: Path to a template file to use for new notes (leave empty for blank notes)')
			.addText(text => text
				.setPlaceholder('Templates/note-template.md')
				.setValue(this.plugin.settings.templatePath)
				.onChange(async (value) => {
					this.plugin.settings.templatePath = value;
					await this.plugin.saveSettings();
				}));
	}
}
