/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { localize } from '../../../../nls.js';

// Register configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'cypressAssistant',
	title: localize('cypressAssistantConfigurationTitle', 'Test Automation'),
	properties: {
		'cypressAssistant.openaiApiKey': {
			type: 'string',
			default: '',
			description: localize('cypressAssistant.openaiApiKey', 'OpenAI API Key for test generation'),
			scope: 3 // ConfigurationScope.APPLICATION
		},
		'cypressAssistant.openaiModel': {
			type: 'string',
			default: 'gpt-4',
			enum: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo-preview'],
			description: localize('cypressAssistant.openaiModel', 'OpenAI model to use for test generation'),
			scope: 3
		},
		'cypressAssistant.baseUrl': {
			type: 'string',
			default: 'http://localhost:3000',
			description: localize('cypressAssistant.baseUrl', 'Base URL for test execution'),
			scope: 3
		},
		'cypressAssistant.testTimeout': {
			type: 'number',
			default: 30000,
			description: localize('cypressAssistant.testTimeout', 'Default timeout for test execution (in milliseconds)'),
			scope: 3
		},
		'cypressAssistant.enableDebugMode': {
			type: 'boolean',
			default: false,
			description: localize('cypressAssistant.enableDebugMode', 'Enable debug mode for detailed logging'),
			scope: 3
		}
	}
});