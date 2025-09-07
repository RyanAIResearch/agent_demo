/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { append, $, clearNode } from '../../../../base/browser/dom.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { AutomationService, IPRDAnalysis, ITestCase } from './automationService.js';
import { IWebviewService, IWebview } from '../../webview/browser/webview.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export class CypressAssistantView extends ViewPane {

	private container!: HTMLElement;
	private mainContent!: HTMLElement;
	private prdSection!: HTMLElement;
	private testCasesSection!: HTMLElement;
	private executionSection!: HTMLElement;
	
	private currentPRD: string = '';
	private currentAnalysis: IPRDAnalysis | null = null;
	private automationService: AutomationService;
	private runningTerminals: Map<string, any> = new Map();
	
	// Webview相关
	private webviewContainer: HTMLElement | null = null;
	private webview: IWebview | null = null;
	private webviewService: IWebviewService;
	
	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService override readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IContextViewService contextViewService: IContextViewService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWebviewService webviewService: IWebviewService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		
		this.webviewService = webviewService;
		this.automationService = new AutomationService(
			terminalService,
			workspaceContextService,
			fileService,
			configurationService
		);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		
		this.container = container;
		this.container.classList.add('cypress-assistant-view');
		
		this.renderCustomHeader();
		this.renderTabs();
		
		this.mainContent = append(this.container, $('.main-content'));
		
		this.prdSection = append(this.mainContent, $('.prd-section'));
		this.testCasesSection = append(this.mainContent, $('.test-cases-section', { style: 'display:none' }));
		this.executionSection = append(this.mainContent, $('.execution-section', { style: 'display:none' }));
		
		this.renderPRDSection();
		this.applyStyles();
	}
	
	private renderCustomHeader(): void {
		const header = append(this.container, $('.cypress-assistant-header'));
		const title = append(header, $('.title'));
		title.textContent = '🤖 AI Test Automation Suite';
		
		const description = append(header, $('.description'));
		description.textContent = 'PRD → Test Cases → Code Generation → Automated Execution';
	}
	
	private renderTabs(): void {
		const tabContainer = append(this.container, $('.tab-container'));
		
		const tabs = [
			{ id: 'prd', label: '📋 PRD Input', active: true },
			{ id: 'testcases', label: '✅ Test Cases', active: false },
			{ id: 'execution', label: '🚀 Execution', active: false }
		];
		
		tabs.forEach(tab => {
			const tabElement = append(tabContainer, $('.tab', { 'data-tab': tab.id }));
			tabElement.textContent = tab.label;
			if (tab.active) {
				tabElement.classList.add('active');
			}
			
			tabElement.addEventListener('click', () => this.switchTab(tab.id));
		});
	}
	
	private switchTab(tabId: string): void {
		this.container.querySelectorAll('.tab').forEach(tab => {
			tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
		});
		
		this.prdSection.style.display = tabId === 'prd' ? 'block' : 'none';
		this.testCasesSection.style.display = tabId === 'testcases' ? 'block' : 'none';
		this.executionSection.style.display = tabId === 'execution' ? 'block' : 'none';
		
		// 清理webview
		if (tabId !== 'execution' && this.webview) {
			this.disposeWebview();
		}
		
		if (tabId === 'testcases' && this.currentAnalysis) {
			this.renderTestCases();
		} else if (tabId === 'execution') {
			this.renderExecutionPanel();
		}
	}
	
	private renderPRDSection(): void {
		clearNode(this.prdSection);
		
		const header = append(this.prdSection, $('.section-header'));
		header.textContent = 'Product Requirements Document';
		
		const apiKeyContainer = append(this.prdSection, $('.api-key-container'));
		apiKeyContainer.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 12px; background: var(--vscode-input-background); border-radius: 4px;';
		
		const apiKeyLabel = append(apiKeyContainer, $('.label'));
		apiKeyLabel.textContent = 'OpenAI API Key:';
		apiKeyLabel.style.cssText = 'font-weight: bold; min-width: 120px;';
		
		const apiKeyInput = append(apiKeyContainer, $('input.api-key-input', {
			type: 'password',
			placeholder: 'sk-...',
			value: this.automationService.getApiKey() || ''
		})) as HTMLInputElement;
		apiKeyInput.style.cssText = 'flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px;';
		
		const saveKeyButton = append(apiKeyContainer, $('button.custom-button')) as HTMLButtonElement;
		saveKeyButton.textContent = '💾 Save';
		saveKeyButton.addEventListener('click', () => {
			this.automationService.setApiKey(apiKeyInput.value);
			this.notificationService.info('API Key saved!');
		});
		
		const description = append(this.prdSection, $('.section-description'));
		description.textContent = 'Enter your PRD or test URL below:';
		
		const textareaWrapper = append(this.prdSection, $('.textarea-wrapper'));
		const textarea = append(textareaWrapper, $('textarea.prd-textarea', {
			placeholder: 'Enter PRD or:\n\nTest login for:\nURL: https://example.com/login\nUsername: user@example.com\nPassword: mypassword123',
			rows: '15'
		})) as HTMLTextAreaElement;
		
		textarea.addEventListener('input', () => {
			this.currentPRD = textarea.value;
		});
		
		const buttonsContainer = append(this.prdSection, $('.buttons-container'));
		
		const sampleButton = append(buttonsContainer, $('button.custom-button')) as HTMLButtonElement;
		sampleButton.textContent = '📄 Load Sample';
		sampleButton.addEventListener('click', () => {
			textarea.value = 'Test login for:\nURL: https://the-internet.herokuapp.com/login\nUsername: tomsmith\nPassword: SuperSecretPassword!';
			this.currentPRD = textarea.value;
		});
		
		const analyzeButton = append(buttonsContainer, $('button.custom-button')) as HTMLButtonElement;
		analyzeButton.textContent = '🔍 Analyze';
		analyzeButton.addEventListener('click', async () => {
			if (!this.currentPRD) {
				this.notificationService.warn('Please enter content first');
				return;
			}
			
			analyzeButton.disabled = true;
			analyzeButton.textContent = '⏳ Analyzing...';
			
			try {
				this.currentAnalysis = await this.automationService.analyzePRD(this.currentPRD);
				this.notificationService.info(`Generated ${this.currentAnalysis.testCases.length} test cases!`);
				this.switchTab('testcases');
			} catch (error: any) {
				this.notificationService.error(`Failed: ${error.message}`);
			} finally {
				analyzeButton.disabled = false;
				analyzeButton.textContent = '🔍 Analyze';
			}
		});
	}
	
	private renderTestCases(): void {
		if (!this.currentAnalysis) return;
		
		clearNode(this.testCasesSection);
		
		const header = append(this.testCasesSection, $('.section-header'));
		header.textContent = `Test Cases (${this.currentAnalysis.testCases.length})`;
		
		this.currentAnalysis.testCases.forEach(testCase => {
			const card = append(this.testCasesSection, $('.test-case-card'));
			
			const statusBadge = append(card, $('.status-badge'));
			statusBadge.textContent = testCase.status || 'pending';
			statusBadge.classList.add(`status-${testCase.status || 'pending'}`);
			
			const title = append(card, $('.test-title'));
			title.textContent = testCase.name;
			
			const description = append(card, $('.test-description'));
			description.textContent = testCase.description;
			
			const actions = append(card, $('.card-actions'));
			const generateBtn = append(actions, $('button.custom-button')) as HTMLButtonElement;
			generateBtn.textContent = '⚙️ Generate Code';
			generateBtn.addEventListener('click', async () => {
				try {
					testCase.cypressCode = await this.automationService.generateCypressCode(testCase);
					testCase.status = 'generated';
					this.notificationService.info('Code generated!');
					this.renderTestCases();
				} catch (error: any) {
					this.notificationService.error(`Failed: ${error.message}`);
				}
			});
		});
		
		const generateAllContainer = append(this.testCasesSection, $('.generate-all-container'));
		const generateAllBtn = append(generateAllContainer, $('button.custom-button')) as HTMLButtonElement;
		generateAllBtn.textContent = '🚀 Generate All';
		generateAllBtn.addEventListener('click', async () => {
			if (!this.currentAnalysis) return;
			
			generateAllBtn.disabled = true;
			generateAllBtn.textContent = '⏳ Generating...';
			
			try {
				for (const testCase of this.currentAnalysis.testCases) {
					if (!testCase.cypressCode) {
						testCase.cypressCode = await this.automationService.generateCypressCode(testCase);
						testCase.status = 'generated';
					}
				}
				this.notificationService.info('All tests generated!');
				this.renderTestCases();
			} catch (error: any) {
				this.notificationService.error(`Failed: ${error.message}`);
			} finally {
				generateAllBtn.disabled = false;
				generateAllBtn.textContent = '🚀 Generate All';
			}
		});
	}
	
	private renderExecutionPanel(): void {
		clearNode(this.executionSection);
		
		const header = append(this.executionSection, $('.section-header'));
		header.textContent = 'Test Execution';
		
		const frameworkContainer = append(this.executionSection, $('.framework-selection'));
		const frameworkLabel = append(frameworkContainer, $('.label'));
		frameworkLabel.textContent = 'Framework:';
		
		let selectedFramework = 'playwright';
		
		['playwright', 'cypress'].forEach(fw => {
			const radio = append(frameworkContainer, $('input', {
				type: 'radio',
				name: 'framework',
				value: fw,
				id: `fw-${fw}`,
				checked: fw === 'playwright' ? 'true' : undefined
			})) as HTMLInputElement;
			
			const label = append(frameworkContainer, $('label', { for: `fw-${fw}` }));
			label.textContent = fw.charAt(0).toUpperCase() + fw.slice(1);
			
			radio.addEventListener('change', () => {
				if (radio.checked) {
					selectedFramework = fw;
				}
			});
		});
		
		const runContainer = append(this.executionSection, $('.run-container'));
		
		const runButton = append(runContainer, $('button.custom-button')) as HTMLButtonElement;
		runButton.textContent = '▶️ Run Tests';
		runButton.addEventListener('click', async () => {
			await this.runTests(selectedFramework);
		});
		
		const openUIButton = append(runContainer, $('button.custom-button')) as HTMLButtonElement;
		openUIButton.textContent = '🌐 Open Test UI';
		openUIButton.addEventListener('click', async () => {
			openUIButton.disabled = true;
			openUIButton.textContent = '⏳ Opening...';
			
			try {
				if (selectedFramework === 'playwright') {
					await this.openPlaywrightUI();
				} else {
					await this.openCypressUI();
				}
			} catch (error: any) {
				this.notificationService.error(`Failed: ${error.message}`);
			} finally {
				openUIButton.disabled = false;
				openUIButton.textContent = '🌐 Open Test UI';
			}
		});
		
		const browserButton = append(runContainer, $('button.custom-button')) as HTMLButtonElement;
		browserButton.textContent = '🌍 Open Browser';
		browserButton.addEventListener('click', async () => {
			await this.openEmbeddedBrowser('https://www.google.com');
		});
		
		const resultsContainer = append(this.executionSection, $('.results-container'));
		const resultsHeader = append(resultsContainer, $('.results-header'));
		resultsHeader.textContent = 'Results';
		
		const resultsArea = append(resultsContainer, $('.results-area'));
		resultsArea.textContent = 'Test results will appear here...';
	}
	
	private async runTests(framework: string): Promise<void> {
		if (!this.currentAnalysis || this.currentAnalysis.testCases.length === 0) {
			this.notificationService.warn('No tests to run');
			return;
		}
		
		const testsWithCode = this.currentAnalysis.testCases.filter(tc => tc.cypressCode);
		if (testsWithCode.length === 0) {
			this.notificationService.warn('Please generate test code first');
			return;
		}
		
		try {
			await this.automationService.executeTests(
				testsWithCode,
				framework as 'cypress' | 'playwright',
				{ headed: false }
			);
			this.notificationService.info('Tests started in terminal');
		} catch (error: any) {
			this.notificationService.error(`Failed: ${error.message}`);
		}
	}
	
	/**
	 * 创建嵌入式浏览器（使用Webview）
	 */
	private async openEmbeddedBrowser(url: string): Promise<void> {
		clearNode(this.executionSection);
		
		const container = append(this.executionSection, $('.webview-container'));
		container.style.cssText = 'height: 700px; display: flex; flex-direction: column; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden;';
		
		// 创建控制栏
		const controlBar = append(container, $('.control-bar'));
		controlBar.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border);';
		
		// 导航按钮
		const backBtn = append(controlBar, $('button.custom-button')) as HTMLButtonElement;
		backBtn.textContent = '←';
		backBtn.addEventListener('click', () => {
			if (this.webview) {
				this.webview.postMessage({ command: 'goBack' });
			}
		});
		
		const forwardBtn = append(controlBar, $('button.custom-button')) as HTMLButtonElement;
		forwardBtn.textContent = '→';
		forwardBtn.addEventListener('click', () => {
			if (this.webview) {
				this.webview.postMessage({ command: 'goForward' });
			}
		});
		
		const refreshBtn = append(controlBar, $('button.custom-button')) as HTMLButtonElement;
		refreshBtn.textContent = '🔄';
		refreshBtn.addEventListener('click', () => {
			if (this.webview) {
				this.webview.postMessage({ command: 'reload' });
			}
		});
		
		// URL输入框
		const urlInput = append(controlBar, $('input.url-input', {
			type: 'text',
			value: url
		})) as HTMLInputElement;
		urlInput.style.cssText = 'flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px;';
		
		// 导航按钮
		const goBtn = append(controlBar, $('button.custom-button')) as HTMLButtonElement;
		goBtn.textContent = 'Go';
		goBtn.addEventListener('click', () => {
			const newUrl = urlInput.value;
			if (newUrl && this.webview) {
				this.webview.postMessage({ command: 'navigate', url: newUrl });
			}
		});
		
		// 关闭按钮
		const closeBtn = append(controlBar, $('button.custom-button')) as HTMLButtonElement;
		closeBtn.textContent = '❌';
		closeBtn.addEventListener('click', () => {
			this.disposeWebview();
			this.renderExecutionPanel();
		});
		
		// 创建Webview容器
		this.webviewContainer = append(container, $('.webview-content'));
		this.webviewContainer.style.cssText = 'flex: 1; position: relative;';
		
		// 创建Webview
		this.createWebview(url);
	}
	
	/**
	 * 创建Webview
	 */
	private createWebview(initialUrl: string): void {
		if (!this.webviewContainer) return;
		
		const options = {
			enableScripts: true,
			enableForms: true,
			enableCommandUris: true,
			localResourceRoots: [],
			retainContextWhenHidden: true
		};
		
		// 创建webview
		this.webview = this.webviewService.createWebviewElement(
			generateUuid(),
			options,
			{},
			undefined
		);
		
		// 设置HTML内容（iframe方式）
		this.webview.html = this.getWebviewContent(initialUrl);
		
		// 监听消息
		this._register(this.webview.onMessage(message => {
			switch (message.command) {
				case 'urlChanged':
					const urlInput = this.executionSection.querySelector('.url-input') as HTMLInputElement;
					if (urlInput) {
						urlInput.value = message.url;
					}
					break;
				case 'error':
					this.notificationService.error(`Browser error: ${message.error}`);
					break;
			}
		}));
		
		// 将webview挂载到容器
		this.webview.mountTo(this.webviewContainer);
	}
	
	/**
	 * 获取Webview HTML内容
	 */
	private getWebviewContent(url: string): string {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<style>
				body, html {
					margin: 0;
					padding: 0;
					width: 100%;
					height: 100vh;
					overflow: hidden;
				}
				iframe {
					width: 100%;
					height: 100%;
					border: none;
				}
				.loading {
					display: flex;
					justify-content: center;
					align-items: center;
					height: 100vh;
					font-size: 18px;
					color: #666;
				}
			</style>
		</head>
		<body>
			<div id="content">
				<iframe id="browser" src="${url}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"></iframe>
			</div>
			<script>
				const vscode = acquireVsCodeApi();
				const iframe = document.getElementById('browser');
				
				// 监听VSCode发来的消息
				window.addEventListener('message', event => {
					const message = event.data;
					switch (message.command) {
						case 'navigate':
							iframe.src = message.url;
							break;
						case 'reload':
							iframe.contentWindow.location.reload();
							break;
						case 'goBack':
							iframe.contentWindow.history.back();
							break;
						case 'goForward':
							iframe.contentWindow.history.forward();
							break;
					}
				});
				
				// 监听iframe加载事件
				iframe.addEventListener('load', () => {
					try {
						const url = iframe.contentWindow.location.href;
						vscode.postMessage({ command: 'urlChanged', url: url });
					} catch (e) {
						// 跨域情况下无法获取URL
						console.log('Cross-origin URL');
					}
				});
				
				// 错误处理
				iframe.addEventListener('error', (e) => {
					vscode.postMessage({ command: 'error', error: 'Failed to load page' });
				});
			</script>
		</body>
		</html>`;
	}
	
	/**
	 * 打开Playwright UI（改进版）
	 */
	private async openPlaywrightUI(): Promise<void> {
		clearNode(this.executionSection);
		
		const container = append(this.executionSection, $('.ui-container'));
		container.style.cssText = 'height: 600px; display: flex; flex-direction: column;';
		
		const header = append(container, $('.ui-header'));
		header.style.cssText = 'padding: 10px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border);';
		header.textContent = '🎭 Playwright Test UI - Starting...';
		
		const message = append(container, $('.message'));
		message.style.cssText = 'padding: 20px;';
		
		// 使用DOM操作替代innerHTML
		const h3 = append(message, $('h3'));
		h3.textContent = 'Starting Playwright UI Server...';
		
		const p1 = append(message, $('p'));
		p1.textContent = 'Please wait while we start the test server...';
		
		const p2 = append(message, $('p'));
		p2.style.cssText = 'color: var(--vscode-descriptionForeground);';
		p2.textContent = 'This may take a few seconds.';
		
		// 启动Playwright UI服务器
		const terminal = await this.terminalService.createTerminal({
			name: 'Playwright UI',
			hideFromUser: true
		});
		
		this.runningTerminals.set('playwright-ui', terminal);
		
		await terminal.processReady;
		
		const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		if (!workspacePath) {
			this.notificationService.error('No workspace folder');
			return;
		}
		
		terminal.sendText(`cd "${workspacePath}"`, true);
		terminal.sendText('npx playwright test --ui', true);
		
		// 等待服务器启动
		await new Promise(resolve => setTimeout(resolve, 5000));
		
		// 使用Webview显示Playwright UI
		await this.openEmbeddedBrowser('http://localhost:51523');
		
		// 添加额外的控制按钮
		const controlsContainer = this.executionSection.querySelector('.control-bar');
		if (controlsContainer) {
			const stopBtn = append(controlsContainer, $('button.custom-button')) as HTMLButtonElement;
			stopBtn.textContent = '⏹️ Stop Server';
			stopBtn.addEventListener('click', () => {
				const terminal = this.runningTerminals.get('playwright-ui');
				if (terminal) {
					terminal.dispose();
					this.runningTerminals.delete('playwright-ui');
				}
				this.notificationService.info('Playwright UI server stopped');
				this.renderExecutionPanel();
			});
		}
	}
	
	/**
	 * 打开Cypress UI（改进版）
	 */
	private async openCypressUI(): Promise<void> {
		clearNode(this.executionSection);
		
		const container = append(this.executionSection, $('.ui-container'));
		container.style.cssText = 'display: flex; flex-direction: column; padding: 20px;';
		
		const header = append(container, $('.header'));
		
		// 使用DOM操作而不是innerHTML
		const h3 = append(header, $('h3'));
		h3.textContent = '🧪 Cypress Test Runner';
		
		const p = append(header, $('p'));
		p.textContent = 'Choose how to run your Cypress tests:';
		
		const optionsContainer = append(container, $('.options'));
		optionsContainer.style.cssText = 'display: flex; gap: 20px; margin-top: 20px;';
		
		// 选项1：在终端运行（headless）
		const headlessOption = append(optionsContainer, $('.option-card'));
		headlessOption.style.cssText = 'flex: 1; padding: 20px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; cursor: pointer;';
		
		const h4_1 = append(headlessOption, $('h4'));
		h4_1.textContent = '📺 Headless Mode';
		
		const p_1 = append(headlessOption, $('p'));
		p_1.textContent = 'Run tests in terminal with video recording';
		
		headlessOption.addEventListener('click', async () => {
			const terminal = await this.terminalService.createTerminal({
				name: 'Cypress Tests'
			});
			
			await terminal.processReady;
			
			const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
			if (!workspacePath) return;
			
			terminal.sendText(`cd "${workspacePath}"`, true);
			terminal.sendText('npx cypress run --video', true);
			terminal.show();
			
			this.notificationService.info('Cypress tests running in terminal');
			this.renderExecutionPanel();
		});
		
		// 选项2：打开Cypress App
		const guiOption = append(optionsContainer, $('.option-card'));
		guiOption.style.cssText = 'flex: 1; padding: 20px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; cursor: pointer;';
		
		const h4_2 = append(guiOption, $('h4'));
		h4_2.textContent = '🖥️ Interactive Mode';
		
		const p_2 = append(guiOption, $('p'));
		p_2.textContent = 'Open Cypress App in external window';
		
		guiOption.addEventListener('click', async () => {
			const terminal = await this.terminalService.createTerminal({
				name: 'Cypress App'
			});
			
			await terminal.processReady;
			
			const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
			if (!workspacePath) return;
			
			terminal.sendText(`cd "${workspacePath}"`, true);
			terminal.sendText('npx cypress open', true);
			terminal.show();
			
			this.notificationService.info('Opening Cypress App...');
			this.renderExecutionPanel();
		});
		
		const backBtn = append(container, $('button.custom-button')) as HTMLButtonElement;
		backBtn.textContent = '← Back';
		backBtn.style.marginTop = '20px';
		backBtn.addEventListener('click', () => {
			this.renderExecutionPanel();
		});
	}
	
	/**
	 * 清理Webview
	 */
	private disposeWebview(): void {
		if (this.webview) {
			this.webview.dispose();
			this.webview = null;
		}
		if (this.webviewContainer) {
			clearNode(this.webviewContainer);
			this.webviewContainer = null;
		}
	}
	
	private applyStyles(): void {
		const style = document.createElement('style');
		style.textContent = `
			.cypress-assistant-view {
				display: flex;
				flex-direction: column;
				height: 100%;
				padding: 12px;
				overflow-y: auto;
			}
			
			.cypress-assistant-header {
				padding: 16px;
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				border-radius: 8px;
				margin-bottom: 16px;
				color: white;
			}
			
			.cypress-assistant-header .title {
				font-size: 18px;
				font-weight: bold;
				margin-bottom: 4px;
			}
			
			.cypress-assistant-header .description {
				font-size: 13px;
				opacity: 0.95;
			}
			
			.tab-container {
				display: flex;
				gap: 8px;
				margin-bottom: 16px;
				border-bottom: 2px solid var(--vscode-panel-border);
			}
			
			.tab {
				padding: 8px 16px;
				cursor: pointer;
				border-radius: 4px 4px 0 0;
				transition: background 0.2s;
			}
			
			.tab:hover {
				background: var(--vscode-list-hoverBackground);
			}
			
			.tab.active {
				background: var(--vscode-badge-background);
				color: var(--vscode-badge-foreground);
			}
			
			.main-content {
				flex: 1;
				overflow-y: auto;
			}
			
			.section-header {
				font-size: 16px;
				font-weight: bold;
				margin-bottom: 8px;
			}
			
			.section-description {
				font-size: 13px;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 16px;
			}
			
			.textarea-wrapper {
				margin-bottom: 16px;
			}
			
			.prd-textarea {
				width: 100%;
				padding: 12px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				font-family: var(--vscode-editor-font-family);
				font-size: 13px;
				resize: vertical;
			}
			
			.buttons-container {
				display: flex;
				gap: 12px;
			}
			
			.test-case-card {
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 8px;
				padding: 16px;
				margin-bottom: 12px;
			}
			
			.status-badge {
				display: inline-block;
				padding: 2px 8px;
				border-radius: 12px;
				font-size: 11px;
				font-weight: bold;
				text-transform: uppercase;
				margin-bottom: 8px;
			}
			
			.status-pending { background: #fbbf24; color: #78350f; }
			.status-generated { background: #60a5fa; color: #1e3a8a; }
			.status-running { background: #a78bfa; color: #4c1d95; }
			.status-passed { background: #34d399; color: #064e3b; }
			.status-failed { background: #f87171; color: #7f1d1d; }
			
			.test-title {
				font-weight: bold;
				margin-bottom: 4px;
			}
			
			.test-description {
				font-size: 13px;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 12px;
			}
			
			.card-actions {
				display: flex;
				gap: 8px;
			}
			
			.generate-all-container {
				margin-top: 24px;
				text-align: center;
			}
			
			.framework-selection {
				display: flex;
				align-items: center;
				gap: 16px;
				margin-bottom: 16px;
			}
			
			.framework-selection input[type="radio"] {
				margin-right: 4px;
			}
			
			.run-container {
				display: flex;
				gap: 10px;
				margin-bottom: 24px;
			}
			
			.results-container {
				border-top: 1px solid var(--vscode-panel-border);
				padding-top: 16px;
			}
			
			.results-header {
				font-weight: bold;
				margin-bottom: 8px;
			}
			
			.results-area {
				padding: 12px;
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				min-height: 100px;
				font-family: var(--vscode-editor-font-family);
			}
			
			.ui-container {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				overflow: hidden;
			}
			
			.controls {
				background: var(--vscode-editor-background);
				border-top: 1px solid var(--vscode-panel-border);
			}
			
			.webview-container {
				background: white;
			}
			
			.control-bar {
				user-select: none;
			}
			
			.url-input {
				font-family: var(--vscode-font-family);
				font-size: 13px;
			}
			
			.option-card:hover {
				background: var(--vscode-list-hoverBackground) !important;
				transform: translateY(-2px);
				transition: all 0.2s;
			}
			
			.option-card h4 {
				margin: 0 0 8px 0;
				color: var(--vscode-foreground);
			}
			
			.option-card p {
				margin: 0;
				font-size: 13px;
				color: var(--vscode-descriptionForeground);
			}
			
			/* 自定义按钮样式 */
			.custom-button {
				padding: 6px 14px;
				border-radius: 3px;
				cursor: pointer;
				font-size: 13px;
				line-height: 18px;
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border: 1px solid transparent;
				outline: none;
				transition: background 0.15s ease;
				font-family: var(--vscode-font-family);
			}
			
			.custom-button:hover:not(:disabled) {
				background: var(--vscode-button-hoverBackground);
			}
			
			.custom-button:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}
			
			.custom-button:active:not(:disabled) {
				transform: translateY(1px);
			}
		`;
		
		if (!document.head.querySelector('style[data-cypress-assistant]')) {
			style.setAttribute('data-cypress-assistant', 'true');
			document.head.appendChild(style);
		}
	}
	
	override focus(): void {
		super.focus();
	}
	
	override dispose(): void {
		// 清理所有运行中的终端
		this.runningTerminals.forEach(terminal => terminal.dispose());
		this.runningTerminals.clear();
		
		// 清理webview
		this.disposeWebview();
		
		super.dispose();
	}
}