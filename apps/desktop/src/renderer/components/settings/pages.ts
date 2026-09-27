import { registry } from '../../registry';
import AccountPage from './AccountPage';
import KeyboardPage from './KeyboardPage';
import TagsPage from './TagsPage';
import VaultPage from './VaultPage';

// Hand-built Settings pages. They follow the generated sections in `position`
// order. Registering, rather than hard-coding them into the page, is what lets
// a module add its own.

registry.addPage('settings', { id: 'keyboard', label: 'Keyboard', component: KeyboardPage, position: 10 });
registry.addPage('settings', { id: 'vault',    label: 'Vault',    component: VaultPage,    position: 20 });
registry.addPage('settings', { id: 'tags',     label: 'Tags',     component: TagsPage,     position: 30 });
registry.addPage('settings', { id: 'account',  label: 'Account',  component: AccountPage,  position: 40 });
