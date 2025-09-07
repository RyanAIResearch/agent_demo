/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export interface ITestCase {
	id: string;
	name: string;
	description: string;
	steps: string[];
	expectedResult: string;
	cypressCode?: string;
	playwrightCode?: string;
	status?: 'pending' | 'generated' | 'running' | 'passed' | 'failed';
	testData?: any; // 添加测试数据字段
}

export interface IPRDAnalysis {
	features: string[];
	userStories: string[];
	acceptanceCriteria: string[];
	testCases: ITestCase[];
}

interface OpenAIResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

export class AutomationService {
	private openaiApiKey: string | undefined;
	private openaiEndpoint = 'https://api.openai.com/v1/chat/completions';
	private defaultModel = 'gpt-4';
	
	constructor(
		private readonly terminalService: ITerminalService,
		private readonly workspaceService: IWorkspaceContextService,
		private readonly fileService: IFileService,
		private readonly configurationService?: IConfigurationService
	) {
		// Get API key from VS Code settings
		this.openaiApiKey = this.configurationService?.getValue('cypressAssistant.openaiApiKey');
	}

	/**
	 * Set OpenAI API Key
	 */
	setApiKey(apiKey: string): void {
		this.openaiApiKey = apiKey;
	}

	/**
	 * Get OpenAI API Key
	 */
	getApiKey(): string | undefined {
		return this.openaiApiKey || this.configurationService?.getValue('cypressAssistant.openaiApiKey');
	}

	/**
	 * Parse test data from PRD if it contains URL and credentials
	 */
	private parseTestDataFromPRD(prd: string): any | null {
		const lines = prd.split('\n');
		let testData: any = {};
		
		// Look for URL pattern
		const urlPattern = /URL:\s*(https?:\/\/[^\s]+)/i;
		const usernamePattern = /Username:\s*([^\s]+)/i;
		const passwordPattern = /Password:\s*([^\s]+)/i;
		
		for (const line of lines) {
			const urlMatch = line.match(urlPattern);
			const usernameMatch = line.match(usernamePattern);
			const passwordMatch = line.match(passwordPattern);
			
			if (urlMatch) testData.url = urlMatch[1];
			if (usernameMatch) testData.username = usernameMatch[1];
			if (passwordMatch) testData.password = passwordMatch[1];
		}
		
		// Return test data if we found at least a URL
		return testData.url ? testData : null;
	}

	/**
	 * Generate test cases for URL-based login testing
	 */
	private generateLoginTestCasesForURL(testData: any): ITestCase[] {
		const { url, username, password } = testData;
		
		return [
			{
				id: 'login-001',
				name: 'Successful Login with Valid Credentials',
				description: `Verify user can login to ${url} with valid credentials`,
				steps: [
					`Navigate to ${url}`,
					`Enter username: ${username}`,
					`Enter password: ${password}`,
					'Click login/submit button',
					'Verify successful login'
				],
				expectedResult: 'User is successfully logged in and redirected to dashboard/home page',
				status: 'pending',
				testData // Store test data with the test case
			},
			{
				id: 'login-002',
				name: 'Invalid Username Test',
				description: 'Verify system shows error for invalid username',
				steps: [
					`Navigate to ${url}`,
					'Enter invalid username',
					`Enter password: ${password}`,
					'Click login button'
				],
				expectedResult: 'Error message is displayed indicating invalid username',
				status: 'pending',
				testData
			},
			{
				id: 'login-003',
				name: 'Invalid Password Test',
				description: 'Verify system shows error for invalid password',
				steps: [
					`Navigate to ${url}`,
					`Enter username: ${username}`,
					'Enter invalid password',
					'Click login button'
				],
				expectedResult: 'Error message is displayed indicating invalid password',
				status: 'pending',
				testData
			},
			{
				id: 'login-004',
				name: 'Empty Fields Validation',
				description: 'Verify validation for empty username and password fields',
				steps: [
					`Navigate to ${url}`,
					'Leave username and password fields empty',
					'Click login button'
				],
				expectedResult: 'Validation messages appear for required fields',
				status: 'pending',
				testData
			}
		];
	}

	/**
	 * Call OpenAI API with model parameter
	 */
	private async callOpenAIWithModel(prompt: string, systemPrompt: string, model: string): Promise<string> {
		if (!this.openaiApiKey) {
			throw new Error('OpenAI API key not configured. Please set it in settings.');
		}

		try {
			const response = await fetch(this.openaiEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.openaiApiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: prompt }
					],
					temperature: 0.7,
					max_tokens: 2000
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`OpenAI API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
			}

			const data: OpenAIResponse = await response.json();
			return data.choices[0].message.content;
		} catch (error) {
			console.error('OpenAI API call failed:', error);
			throw error;
		}
	}

	/**
	 * Call OpenAI API (legacy method for compatibility)
	 */
	private async callOpenAI(prompt: string, systemPrompt: string): Promise<string> {
		const model = this.configurationService?.getValue('cypressAssistant.openaiModel') || this.defaultModel;
		return this.callOpenAIWithModel(prompt, systemPrompt, model);
	}

	/**
	 * Analyze PRD using OpenAI or fallback
	 */
	async analyzePRD(prd: string): Promise<IPRDAnalysis> {
		// First check if this is a URL-based test request
		const testData = this.parseTestDataFromPRD(prd);
		
		if (testData && testData.url) {
			// This is a specific URL test request, not a PRD
			console.log('Detected URL-based test request:', testData);
			
			return {
				features: ['Login Authentication'],
				userStories: [`As a user, I want to login to ${testData.url}`],
				acceptanceCriteria: [
					'Valid credentials allow successful login',
					'Invalid credentials show appropriate error messages',
					'Empty fields show validation messages'
				],
				testCases: this.generateLoginTestCasesForURL(testData)
			};
		}
		
		// Otherwise, proceed with normal PRD analysis
		const systemPrompt = `You are an expert QA automation engineer. Analyze the given PRD and generate comprehensive test cases.
		Return the response in JSON format with the following structure:
		{
			"features": ["list of features"],
			"userStories": ["list of user stories"],
			"acceptanceCriteria": ["list of acceptance criteria"],
			"testCases": [
				{
					"id": "unique-id",
					"name": "test name",
					"description": "test description",
					"steps": ["step 1", "step 2"],
					"expectedResult": "expected outcome"
				}
			]
		}`;

		const prompt = `Analyze this PRD and generate comprehensive test cases:\n\n${prd}`;

		try {
			const model = this.configurationService?.getValue('cypressAssistant.openaiModel') || this.defaultModel;
			const response = await this.callOpenAIWithModel(prompt, systemPrompt, model);
			const analysis = JSON.parse(response);
			
			// Add status to test cases
			analysis.testCases = analysis.testCases.map((tc: any) => ({
				...tc,
				status: 'pending'
			}));
			
			return analysis;
		} catch (error: any) {
			// Fallback to local generation if OpenAI fails
			console.warn('OpenAI analysis failed, using fallback:', error.message);
			return this.analyzePRDFallback(prd);
		}
	}

	/**
	 * Generate Cypress code using OpenAI or fallback
	 */
	async generateCypressCode(testCase: ITestCase): Promise<string> {
		// Check if we have test data with actual URL and credentials
		const testData = testCase.testData;
		if (testData?.url) {
			// Generate specific code for URL-based test
			return this.generateCypressCodeForURL(testCase, testData);
		}
		
		const systemPrompt = `You are an expert Cypress automation engineer. Generate clean, production-ready Cypress test code.
		Use modern Cypress best practices including:
		- Proper selectors (data-cy, data-test, id, or class attributes)
		- Appropriate assertions
		- Clear comments
		- Error handling
		- Proper waits and timeouts
		If the test case includes a URL, use cy.visit() with that exact URL.`;

		const prompt = `Generate Cypress test code for:
		Test Name: ${testCase.name}
		Description: ${testCase.description}
		Steps: ${testCase.steps.join(', ')}
		Expected Result: ${testCase.expectedResult}`;

		try {
			const model = this.configurationService?.getValue('cypressAssistant.openaiModel') || this.defaultModel;
			const code = await this.callOpenAIWithModel(prompt, systemPrompt, model);
			// Clean up code formatting
			return this.cleanGeneratedCode(code);
		} catch (error: any) {
			console.warn('OpenAI code generation failed, using fallback:', error.message);
			if (testData?.url) {
				return this.generateCypressCodeForURL(testCase, testData);
			}
			return this.generateCypressCodeFallback(testCase);
		}
	}

	/**
	 * Enhanced generateCypressCodeForURL with better selector handling
	 */
	// 修改 automationService.js 中的 generateCypressCodeForURL 方法
	private generateCypressCodeForURL(testCase: ITestCase, testData: any): string {
		const { url, username, password } = testData;
		
		let code = `describe('${testCase.name}', () => {
	it('${testCase.description}', () => {
		// 设置慢速执行，便于观察
		cy.viewport(1280, 720);
		
		// Navigate to the login page
		cy.visit('${url}');
		cy.wait(2000); // 等待页面加载
		
		// 高亮显示用户名输入框
		cy.get('#username').should('be.visible').focus();
		cy.wait(1000); // 暂停1秒
		
		// 慢速输入用户名
		cy.get('#username').clear().type('${username}', { delay: 100 });
		cy.wait(1000);
		
		// 高亮显示密码输入框
		cy.get('#password').focus();
		cy.wait(1000);
		
		// 慢速输入密码
		cy.get('#password').clear().type('${password}', { delay: 100 });
		cy.wait(1000);
		
		// 点击登录按钮前暂停
		cy.get('button[type="submit"]').should('be.visible');
		cy.wait(1500);
		
		// 点击登录
		cy.get('button[type="submit"]').click();
		cy.wait(2000);
		
		// 验证结果
		cy.url().should('include', '/secure');
	});
	});`;
		return code;
	}

	/**
	 * Generate Playwright code using OpenAI or fallback
	 */
	async generatePlaywrightCode(testCase: ITestCase): Promise<string> {
		// Check if we have test data with actual URL and credentials
		const testData = testCase.testData;
		if (testData?.url) {
			// Generate specific code for URL-based test
			return this.generatePlaywrightCodeForURL(testCase, testData);
		}
		
		const systemPrompt = `You are an expert Playwright automation engineer. Generate clean, production-ready Playwright test code.
		Use modern Playwright best practices including:
		- Proper locators
		- Async/await patterns
		- Appropriate assertions with expect
		- Error handling
		- Page object pattern when appropriate`;

		const prompt = `Generate Playwright test code for:
		Test Name: ${testCase.name}
		Description: ${testCase.description}
		Steps: ${testCase.steps.join(', ')}
		Expected Result: ${testCase.expectedResult}`;

		try {
			const model = this.configurationService?.getValue('cypressAssistant.openaiModel') || this.defaultModel;
			const code = await this.callOpenAIWithModel(prompt, systemPrompt, model);
			return this.cleanGeneratedCode(code);
		} catch (error: any) {
			console.warn('OpenAI code generation failed, using fallback:', error.message);
			if (testData?.url) {
				return this.generatePlaywrightCodeForURL(testCase, testData);
			}
			return this.generatePlaywrightCodeFallback(testCase);
		}
	}

	/**
	 * Generate Playwright code specifically for URL-based tests
	 */
	private generatePlaywrightCodeForURL(testCase: ITestCase, testData: any): string {
		const { url, username, password } = testData;
		
		let code = `import { test, expect } from '@playwright/test';
	
	// 配置慢速执行
	test.use({
	  // 每个操作延迟500ms
	  launchOptions: {
		slowMo: 500,
	  },
	  // 视口大小
	  viewport: { width: 1280, height: 720 },
	  // 录制视频
	  video: 'on',
	  // 截图
	  screenshot: 'on',
	});
	
	test('${testCase.name}', async ({ page }) => {
	  // 设置默认超时
	  test.setTimeout(60000);
	  
	  // 导航到登录页面
	  await page.goto('${url}');
	  console.log('📍 Navigated to: ${url}');
	  
	  // 等待页面完全加载
	  await page.waitForLoadState('networkidle');
	  await page.waitForTimeout(2000); // 额外等待2秒
	  
	  // 截图 - 初始页面
	  await page.screenshot({ path: 'login-page.png' });
	`;
	
		if (testCase.name.toLowerCase().includes('successful') || testCase.name.toLowerCase().includes('valid')) {
			code += `
	  
	  // 🔍 查找用户名输入框
	  console.log('🔍 Finding username input...');
	  const usernameInput = page.locator('#username');
	  await usernameInput.scrollIntoViewIfNeeded();
	  await usernameInput.hover(); // 悬停效果
	  await page.waitForTimeout(1000);
	  
	  // ✏️ 输入用户名
	  console.log('✏️ Typing username: ${username}');
	  await usernameInput.click();
	  await usernameInput.fill(''); // 先清空
	  
	  // 逐字输入，模拟真人打字
	  for (const char of '${username}') {
		await usernameInput.type(char, { delay: 100 });
	  }
	  await page.waitForTimeout(1000);
	  
	  // 🔍 查找密码输入框
	  console.log('🔍 Finding password input...');
	  const passwordInput = page.locator('#password');
	  await passwordInput.scrollIntoViewIfNeeded();
	  await passwordInput.hover();
	  await page.waitForTimeout(1000);
	  
	  // ✏️ 输入密码
	  console.log('✏️ Typing password...');
	  await passwordInput.click();
	  await passwordInput.fill('');
	  
	  // 逐字输入密码
	  for (const char of '${password}') {
		await passwordInput.type(char, { delay: 100 });
	  }
	  await page.waitForTimeout(1500);
	  
	  // 📸 截图 - 填写完成
	  await page.screenshot({ path: 'filled-form.png' });
	  
	  // 🖱️ 查找并点击登录按钮
	  console.log('🖱️ Finding login button...');
	  const loginButton = page.locator('button[type="submit"]');
	  await loginButton.scrollIntoViewIfNeeded();
	  await loginButton.hover(); // 悬停在按钮上
	  await page.waitForTimeout(1000);
	  
	  // 高亮显示按钮
	  await loginButton.evaluate(el => {
		el.style.border = '3px solid red';
		el.style.boxShadow = '0 0 10px red';
	  });
	  await page.waitForTimeout(1000);
	  
	  console.log('🚀 Clicking login button...');
	  await loginButton.click();
	  
	  // 等待导航
	  await page.waitForTimeout(2000);
	  
	  // 验证登录成功
	  console.log('✅ Verifying successful login...');
	  await expect(page).toHaveURL(/.*secure/);
	  
	  // 📸 最终截图
	  await page.screenshot({ path: 'login-success.png' });
	  console.log('✅ Test completed successfully!');`;
		}
	
		code += `
	});`;
	
		return code;
	}

	/**
	 * Clean generated code from markdown formatting
	 */
	private cleanGeneratedCode(code: string): string {
		// Remove markdown code blocks if present
		code = code.replace(/```(?:javascript|typescript|js|ts)?\n?/g, '');
		code = code.replace(/```\n?/g, '');
		return code.trim();
	}

	/**
	 * Execute tests with visual browser
	 */
	async executeTests(
		testCases: ITestCase[],
		framework: 'cypress' | 'playwright' | 'puppeteer',
		options: { headed?: boolean; browser?: string } = {}
	): Promise<void> {
		// Save test files
		const testFiles = await this.saveTestFiles(testCases, framework);
		
		// Get workspace folder
		const workspaceFolder = this.workspaceService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			throw new Error('No workspace folder found');
		}
		
		// Create terminal for test execution
		const terminal = await this.terminalService.createTerminal({
			cwd: workspaceFolder.uri
		});
		
		// Wait for terminal to be ready
		await terminal.processReady;
		
		// Setup commands based on framework
		const commands = this.getExecutionCommands(framework, testFiles, options);
		
		// Execute commands
		for (const command of commands) {
			terminal.sendText(command, true);
			await this.delay(1000); // Small delay between commands
		}
		
		// Focus the terminal
		terminal.focus();
		
		// For Cypress, we can also open the Test Runner UI
		if (framework === 'cypress' && options.headed) {
			await this.openCypressTestRunner();
		}
	}

	/**
	 * Get execution commands for each framework
	 */
	private getExecutionCommands(
		framework: string,
		testFiles: string[],
		options: { headed?: boolean; browser?: string }
	): string[] {
		const commands: string[] = [];
		
		// Check if dependencies are installed
		commands.push(`npm list ${framework} || npm install ${framework} --save-dev`);
		
		switch (framework) {
			case 'cypress':
				if (options.headed) {
					// Open Cypress Test Runner with visual browser
					commands.push('npx cypress open');
				} else {
					// Run headless with video recording
					commands.push(`npx cypress run --spec "${testFiles.join(',')}" --record --video`);
				}
				break;
				
			case 'playwright':
				// Install browsers if needed
				commands.push('npx playwright install');
				
				const browserArg = options.browser ? `--browser=${options.browser}` : '--browser=chromium';
				const headedArg = options.headed ? '--headed --slow-mo=100' : '';
				
				if (options.headed) {
					// Use Playwright UI mode for visual testing
					commands.push(`npx playwright test ${testFiles.join(' ')} --ui`);
				} else {
					commands.push(`npx playwright test ${testFiles.join(' ')} ${browserArg} ${headedArg} --reporter=html`);
				}
				break;
				
			case 'puppeteer':
				commands.push('npm list puppeteer || npm install puppeteer --save-dev');
				// For Puppeteer, create and run a custom runner
				commands.push(`node ${testFiles[0]}`);
				break;
		}
		
		return commands;
	}

	/**
	 * Open Cypress Test Runner in browser
	 */
	private async openCypressTestRunner(): Promise<void> {
		// Create cypress.config.js if it doesn't exist
		const workspaceFolder = this.workspaceService.getWorkspace().folders[0];
		if (!workspaceFolder) return;
		
		const configPath = URI.joinPath(workspaceFolder.uri, 'cypress.config.js');
		const configExists = await this.fileService.exists(configPath);
		
		if (!configExists) {
			const defaultConfig = `const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: false,
    specPattern: 'tests/cypress/**/*.cy.{js,jsx,ts,tsx}',
    videosFolder: 'tests/cypress/videos',
    screenshotsFolder: 'tests/cypress/screenshots',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: true,
    screenshotOnRunFailure: true,
    chromeWebSecurity: false,
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    requestTimeout: 10000,
    responseTimeout: 10000,
    experimentalStudio: true,  // Enable Cypress Studio for recording
  },
});`;
			await this.fileService.writeFile(configPath, VSBuffer.fromString(defaultConfig));
		}
	}

	/**
	 * Save test files to workspace
	 */
	private async saveTestFiles(testCases: ITestCase[], framework: string): Promise<string[]> {
		const workspaceFolder = this.workspaceService.getWorkspace().folders[0];
		if (!workspaceFolder) {
			throw new Error('No workspace folder found');
		}
		
		const testDir = URI.joinPath(workspaceFolder.uri, 'tests', framework, 'generated');
		await this.fileService.createFolder(testDir);
		
		const files: string[] = [];
		
		for (const testCase of testCases) {
			let code: string;
			let extension: string;
			
			switch (framework) {
				case 'cypress':
					code = testCase.cypressCode || await this.generateCypressCode(testCase);
					extension = '.cy.js';
					break;
				case 'playwright':
					code = testCase.playwrightCode || await this.generatePlaywrightCode(testCase);
					extension = '.spec.js';
					break;
				default:
					code = testCase.cypressCode || await this.generateCypressCode(testCase);
					extension = '.js';
			}
			
			const filename = `${testCase.id}${extension}`;
			const fileUri = URI.joinPath(testDir, filename);
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(code));
			files.push(fileUri.fsPath);
		}
		
		// Create a test suite file that imports all tests
		await this.createTestSuiteFile(testDir, files, framework);
		
		return files;
	}

	/**
	 * Create test suite file
	 */
	private async createTestSuiteFile(testDir: URI, testFiles: string[], framework: string): Promise<void> {
		let suiteContent = '';
		
		switch (framework) {
			case 'cypress':
				suiteContent = `// Auto-generated test suite
describe('Automated Test Suite', () => {
	${testFiles.map(file => `require('./${file.split('/').pop()}');`).join('\n\t')}
});`;
				break;
				
			case 'playwright':
				suiteContent = `// Auto-generated test suite
${testFiles.map(file => `import './${file.split('/').pop()}';`).join('\n')}`;
				break;
		}
		
		if (suiteContent) {
			const suitePath = URI.joinPath(testDir, `test-suite.${framework === 'cypress' ? 'cy' : 'spec'}.js`);
			await this.fileService.writeFile(suitePath, VSBuffer.fromString(suiteContent));
		}
	}

	// Fallback methods (original implementation)
	private analyzePRDFallback(prd: string): IPRDAnalysis {
		// Check for URL test data first
		const testData = this.parseTestDataFromPRD(prd);
		if (testData && testData.url) {
			return {
				features: ['Login Authentication'],
				userStories: [`As a user, I want to login to ${testData.url}`],
				acceptanceCriteria: [
					'Valid credentials allow successful login',
					'Invalid credentials show appropriate error messages',
					'Empty fields show validation messages'
				],
				testCases: this.generateLoginTestCasesForURL(testData)
			};
		}
		
		return {
			features: this.extractFeatures(prd),
			userStories: this.extractUserStories(prd),
			acceptanceCriteria: this.extractAcceptanceCriteria(prd),
			testCases: this.generateTestCasesFallback(prd)
		};
	}

	private generateCypressCodeFallback(testCase: ITestCase): string {
		// Check for test data first
		if (testCase.testData?.url) {
			return this.generateCypressCodeForURL(testCase, testCase.testData);
		}
		
		const steps = testCase.steps.map(step => this.stepToCypressCommand(step)).join('\n    ');
		const assertions = this.expectedResultToAssertion(testCase.expectedResult);
		
		return `describe('${testCase.name}', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('${testCase.description}', () => {
    ${steps}
    
    // Verify: ${testCase.expectedResult}
    ${assertions}
  });
});`;
	}

	private generatePlaywrightCodeFallback(testCase: ITestCase): string {
		// Check for test data first
		if (testCase.testData?.url) {
			return this.generatePlaywrightCodeForURL(testCase, testCase.testData);
		}
		
		const steps = testCase.steps.map(step => this.stepToPlaywrightCommand(step)).join('\n    ');
		const assertions = this.expectedResultToPlaywrightAssertion(testCase.expectedResult);
		
		return `import { test, expect } from '@playwright/test';

test.describe('${testCase.name}', () => {
  test('${testCase.description}', async ({ page }) => {
    await page.goto('/');
    ${steps}
    
    // Verify: ${testCase.expectedResult}
    ${assertions}
  });
});`;
	}

	// Helper methods (keep existing implementations)
	private extractFeatures(prd: string): string[] {
		const features: string[] = [];
		const featurePatterns = [
			/feature[s]?:\s*([^\n]+)/gi,
			/functionality[ies]?:\s*([^\n]+)/gi,
			/requirement[s]?:\s*([^\n]+)/gi
		];
		
		for (const pattern of featurePatterns) {
			const matches = prd.matchAll(pattern);
			for (const match of matches) {
				features.push(match[1].trim());
			}
		}
		
		if (prd.toLowerCase().includes('login')) features.push('User Authentication');
		if (prd.toLowerCase().includes('cart')) features.push('Shopping Cart');
		if (prd.toLowerCase().includes('checkout')) features.push('Checkout Process');
		if (prd.toLowerCase().includes('search')) features.push('Search Functionality');
		
		return [...new Set(features)];
	}

	private extractUserStories(prd: string): string[] {
		const stories: string[] = [];
		const storyPattern = /as a[n]?\s+(\w+)[,\s]+i (want|need|would like)[^.]+/gi;
		const matches = prd.matchAll(storyPattern);
		
		for (const match of matches) {
			stories.push(match[0]);
		}
		
		if (stories.length === 0) {
			stories.push('As a user, I want to use the system effectively');
		}
		
		return stories;
	}

	private extractAcceptanceCriteria(prd: string): string[] {
		const criteria: string[] = [];
		const criteriaPatterns = [
			/acceptance criteri[a|on]:\s*([^\n]+)/gi,
			/must\s+([^\n]+)/gi,
			/should\s+([^\n]+)/gi
		];
		
		for (const pattern of criteriaPatterns) {
			const matches = prd.matchAll(pattern);
			for (const match of matches) {
				criteria.push(match[1].trim());
			}
		}
		
		return criteria;
	}

	private generateTestCasesFallback(prd: string): ITestCase[] {
		const testCases: ITestCase[] = [];
		const prdLower = prd.toLowerCase();
		
		if (prdLower.includes('login')) {
			testCases.push(...this.generateLoginTestCases());
		}
		
		if (prdLower.includes('cart') || prdLower.includes('shopping')) {
			testCases.push(...this.generateCartTestCases());
		}
		
		if (prdLower.includes('search')) {
			testCases.push(...this.generateSearchTestCases());
		}
		
		if (testCases.length === 0) {
			testCases.push(this.generateGenericTestCase());
		}
		
		return testCases;
	}

	private generateLoginTestCases(): ITestCase[] {
		return [
			{
				id: 'login-001',
				name: 'Successful Login',
				description: 'User can login with valid credentials',
				steps: [
					'Navigate to login page',
					'Enter valid email address',
					'Enter valid password',
					'Click login button'
				],
				expectedResult: 'User is redirected to dashboard',
				status: 'pending'
			},
			{
				id: 'login-002',
				name: 'Invalid Credentials',
				description: 'System shows error for invalid login',
				steps: [
					'Navigate to login page',
					'Enter invalid email or password',
					'Click login button'
				],
				expectedResult: 'Error message is displayed',
				status: 'pending'
			}
		];
	}

	private generateCartTestCases(): ITestCase[] {
		return [
			{
				id: 'cart-001',
				name: 'Add to Cart',
				description: 'User can add products to cart',
				steps: [
					'Navigate to product page',
					'Click add to cart button',
					'Verify cart notification'
				],
				expectedResult: 'Product is added to cart',
				status: 'pending'
			},
			{
				id: 'cart-002',
				name: 'Remove from Cart',
				description: 'User can remove items from cart',
				steps: [
					'Navigate to cart page',
					'Click remove button on item',
					'Confirm removal'
				],
				expectedResult: 'Item is removed from cart',
				status: 'pending'
			}
		];
	}

	private generateSearchTestCases(): ITestCase[] {
		return [
			{
				id: 'search-001',
				name: 'Search Functionality',
				description: 'User can search for items',
				steps: [
					'Navigate to homepage',
					'Enter search term',
					'Click search button'
				],
				expectedResult: 'Search results are displayed',
				status: 'pending'
			}
		];
	}

	private generateGenericTestCase(): ITestCase {
		return {
			id: 'generic-001',
			name: 'Basic Functionality Test',
			description: 'Verify basic system functionality',
			steps: [
				'Navigate to application',
				'Perform primary action',
				'Verify expected behavior'
			],
			expectedResult: 'System works as expected',
			status: 'pending'
		};
	}

	private stepToCypressCommand(step: string): string {
		const stepLower = step.toLowerCase();
		
		if (stepLower.includes('navigate') || stepLower.includes('go to')) {
			return `cy.visit('/');`;
		} else if (stepLower.includes('click')) {
			const element = this.extractElement(step);
			return `cy.get('${element}').click();`;
		} else if (stepLower.includes('enter') || stepLower.includes('type')) {
			const element = this.extractElement(step);
			return `cy.get('${element}').type('test data');`;
		} else if (stepLower.includes('select')) {
			const element = this.extractElement(step);
			return `cy.get('${element}').select('option');`;
		} else if (stepLower.includes('verify') || stepLower.includes('check')) {
			return `cy.get('[data-test]').should('exist');`;
		} else {
			return `// ${step}`;
		}
	}

	private stepToPlaywrightCommand(step: string): string {
		const stepLower = step.toLowerCase();
		
		if (stepLower.includes('navigate') || stepLower.includes('go to')) {
			return `await page.goto('/');`;
		} else if (stepLower.includes('click')) {
			const element = this.extractElement(step);
			return `await page.click('${element}');`;
		} else if (stepLower.includes('enter') || stepLower.includes('type')) {
			const element = this.extractElement(step);
			return `await page.fill('${element}', 'test data');`;
		} else if (stepLower.includes('verify') || stepLower.includes('check')) {
			return `await expect(page.locator('[data-test]')).toBeVisible();`;
		} else {
			return `// ${step}`;
		}
	}

	private expectedResultToAssertion(result: string): string {
		const resultLower = result.toLowerCase();
		
		if (resultLower.includes('redirect')) {
			return `cy.url().should('include', '/dashboard');`;
		} else if (resultLower.includes('display') || resultLower.includes('show')) {
			return `cy.get('[data-test="result"]').should('be.visible');`;
		} else if (resultLower.includes('error')) {
			return `cy.get('[data-test="error"]').should('contain', 'Error');`;
		} else {
			return `cy.get('[data-test="success"]').should('exist');`;
		}
	}

	private expectedResultToPlaywrightAssertion(result: string): string {
		const resultLower = result.toLowerCase();
		
		if (resultLower.includes('redirect')) {
			return `await expect(page).toHaveURL(/.*dashboard/);`;
		} else if (resultLower.includes('display') || resultLower.includes('show')) {
			return `await expect(page.locator('[data-test="result"]')).toBeVisible();`;
		} else if (resultLower.includes('error')) {
			return `await expect(page.locator('[data-test="error"]')).toContainText('Error');`;
		} else {
			return `await expect(page.locator('[data-test="success"]')).toBeVisible();`;
		}
	}

	private extractElement(step: string): string {
		if (step.toLowerCase().includes('button')) return '[data-test="button"]';
		if (step.toLowerCase().includes('input')) return '[data-test="input"]';
		if (step.toLowerCase().includes('email')) return '[data-test="email"]';
		if (step.toLowerCase().includes('password')) return '[data-test="password"]';
		if (step.toLowerCase().includes('search')) return '[data-test="search"]';
		return '[data-test="element"]';
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}