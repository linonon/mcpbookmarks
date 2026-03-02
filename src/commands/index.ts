import * as vscode from 'vscode';
import { CommandDependencies } from './types';
import { registerBookmarkCommands } from './bookmarkCommands';
import { registerGroupCommands } from './groupCommands';
import { registerNavigationCommands } from './navigationCommands';
import { registerCopyCommands } from './copyCommands';
import { registerViewCommands } from './viewCommands';
import { registerUtilityCommands } from './utilityCommands';

export { CommandDependencies } from './types';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies
): void {
  registerBookmarkCommands(context, deps);
  registerGroupCommands(context, deps);
  registerNavigationCommands(context, deps);
  registerCopyCommands(context, deps);
  registerViewCommands(context, deps);
  registerUtilityCommands(context, deps);
}
