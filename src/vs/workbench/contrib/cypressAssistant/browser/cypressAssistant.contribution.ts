/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { CypressAssistantView } from './cypressAssistantView.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import './cypressAssistant.configuration.js'; // Import configuration registration

const CYPRESS_ASSISTANT_CONTAINER_ID = 'workbench.view.cypressAssistantContainer';
const CYPRESS_ASSISTANT_VIEW_ID = 'workbench.view.cypressAssistant';

// Register icon
const cypressAssistantIcon = registerIcon('cypress-assistant-icon', Codicon.beaker, localize('cypressAssistantIcon', 'Cypress Assistant view icon.'));

// Register view container in Panel
const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: CYPRESS_ASSISTANT_CONTAINER_ID,
	title: localize2('cypressAssistant', "Test Automation"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [CYPRESS_ASSISTANT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	hideIfEmpty: false,
	icon: cypressAssistantIcon,
	order: 5, // After terminal (3) and test results (4)
	alwaysUseContainerInfo: true,
}, ViewContainerLocation.Panel, { doNotRegisterOpenCommand: false });

// Register view
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: CYPRESS_ASSISTANT_VIEW_ID,
	name: localize2('cypressAssistantView', "AI Test Generator"),
	containerIcon: cypressAssistantIcon,
	ctorDescriptor: new SyncDescriptor(CypressAssistantView),
	canToggleVisibility: true,
	canMoveView: true,
	order: 0,
	when: undefined, // Always visible
}], viewContainer);

// Register commands
CommandsRegistry.registerCommand('cypressAssistant.show', async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	const paneCompositeService = accessor.get(IPaneCompositePartService);
	
	// First open the panel
	await paneCompositeService.openPaneComposite(CYPRESS_ASSISTANT_CONTAINER_ID, ViewContainerLocation.Panel);
	
	// Then focus the view
	await viewsService.openView(CYPRESS_ASSISTANT_VIEW_ID, true);
});

CommandsRegistry.registerCommand('cypressAssistant.generateTest', async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	await viewsService.openView(CYPRESS_ASSISTANT_VIEW_ID, true);
	// The view will handle the test generation
});

CommandsRegistry.registerCommand('cypressAssistant.runTests', async (accessor: ServicesAccessor) => {
	const viewsService = accessor.get(IViewsService);
	await viewsService.openView(CYPRESS_ASSISTANT_VIEW_ID, true);
	// The view will handle running tests
});

// Register menu items
MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: 'cypressAssistant.generateTest',
		title: localize('generateTest', 'Generate Test'),
		icon: Codicon.sparkle
	},
	when: ContextKeyExpr.equals('view', CYPRESS_ASSISTANT_VIEW_ID),
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: 'cypressAssistant.runTests',
		title: localize('runTests', 'Run Tests'),
		icon: Codicon.play
	},
	when: ContextKeyExpr.equals('view', CYPRESS_ASSISTANT_VIEW_ID),
	group: 'navigation',
	order: 2
});

// Register in command palette
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'cypressAssistant.show',
		title: localize2('showCypressAssistant', 'Test Automation: Show AI Test Generator')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'cypressAssistant.generateTest',
		title: localize2('generateTestCommand', 'Test Automation: Generate Test from PRD')
	}
});

// Log successful registration
console.log('[CypressAssistant] Extension registered successfully!');