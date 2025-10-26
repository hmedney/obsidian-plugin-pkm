import { AbstractInputSuggest, App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from 'obsidian';

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
		// Map of title -> most recent date (YYYY-MM-DD format)
		const titleDates = new Map<string, string>();
		const baseFolder = this.app.vault.getAbstractFileByPath(
			normalizePath(this.settings.baseFolder)
		);

		if (!baseFolder) {
			return [];
		}

		// Regex to match and extract date prefix: YYYY-MM-DD
		const datePattern = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/;

		const extractTitles = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					const fileName = child.basename;
					const match = fileName.match(datePattern);

					if (match) {
						const date = match[1]; // YYYY-MM-DD
						const title = match[2]; // Everything after date

						// Keep the most recent date for each title
						const existingDate = titleDates.get(title);
						if (!existingDate || date > existingDate) {
							titleDates.set(title, date);
						}
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

		// Sort by date descending (most recent first), then return just titles
		return Array.from(titleDates.entries())
			.sort((a, b) => b[1].localeCompare(a[1])) // Compare dates, reverse order
			.map(entry => entry[0]); // Extract just the titles
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

				// Get note content (from template or empty) with frontmatter
				const content = await this.getNoteContent(title, dateStr);

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

	async getNoteContent(title: string, date: string): Promise<string> {
		let content = '';

		// If template path is configured, try to load it
		if (this.settings.templatePath) {
			const templateFile = this.app.vault.getAbstractFileByPath(
				normalizePath(this.settings.templatePath)
			);

			if (templateFile instanceof TFile) {
				content = await this.app.vault.read(templateFile);
			} else {
				console.warn(`Template file not found: ${this.settings.templatePath}`);
			}
		}

		// Add frontmatter with date and title
		return this.addFrontmatter(content, title, date);
	}

	addFrontmatter(content: string, title: string, date: string): string {
		// Check if content already has frontmatter
		const hasFrontmatter = content.trimStart().startsWith('---');

		if (hasFrontmatter) {
			// Extract existing frontmatter and content
			const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
			if (match) {
				const existingFrontmatter = match[1];
				const bodyContent = match[2];

				// Check if date or title already exist in frontmatter
				const hasDate = /^date:/m.test(existingFrontmatter);
				const hasTitle = /^title:/m.test(existingFrontmatter);

				let newFrontmatter = existingFrontmatter;

				// Add missing fields
				if (!hasDate) {
					newFrontmatter = `date: ${date}\n${newFrontmatter}`;
				}
				if (!hasTitle) {
					newFrontmatter = `title: ${title}\n${newFrontmatter}`;
				}

				return `---\n${newFrontmatter}\n---\n${bodyContent}`;
			}
		}

		// No existing frontmatter, create new one
		const frontmatter = `---\ntitle: ${title}\ndate: ${date}\n---\n\n`;
		return frontmatter + content;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TitleSuggest extends AbstractInputSuggest<string> {
	private pastTitles: string[];

	constructor(app: App, inputEl: HTMLInputElement, pastTitles: string[]) {
		super(app, inputEl);
		this.pastTitles = pastTitles;
	}

	getSuggestions(query: string): string[] {
		// Don't show suggestions for empty input
		if (!query || query.trim().length === 0) {
			return [];
		}

		const lowerQuery = query.toLowerCase();
		return this.pastTitles.filter(title =>
			title.toLowerCase().includes(lowerQuery)
		);
	}

	renderSuggestion(title: string, el: HTMLElement): void {
		el.setText(title);
	}

	selectSuggestion(title: string, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(title);
		this.close();
	}
}

class TitleInputModal extends Modal {
	onSubmit: (title: string) => void;
	titleInput: HTMLInputElement;
	titleSuggest: TitleSuggest;
	pastTitles: string[];

	constructor(app: App, pastTitles: string[], onSubmit: (title: string) => void) {
		super(app);
		this.pastTitles = pastTitles;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Create quick note' });

		const inputContainer = contentEl.createDiv();
		inputContainer.createEl('label', { text: 'Note title:' });

		this.titleInput = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Enter note title...'
		});
		this.titleInput.style.width = '100%';

		// Attach autocomplete suggester
		this.titleSuggest = new TitleSuggest(this.app, this.titleInput, this.pastTitles);

		// Handle Enter key to submit form
		this.titleInput.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter' && !evt.isComposing) {
				this.submit();
			}
		});

		// Delay focus to allow modal to fully render and position
		setTimeout(() => this.titleInput.focus(), 10);

		// Create buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const createBtn = buttonContainer.createEl('button', {
			text: 'Create',
			cls: 'mod-cta'
		});
		createBtn.addEventListener('click', () => this.submit());
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
		this.titleSuggest?.close();
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
