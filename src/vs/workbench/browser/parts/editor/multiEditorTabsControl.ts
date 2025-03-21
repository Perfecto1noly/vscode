/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/multieditortabscontrol';
import { isMacintosh, isWindows } from 'vs/base/common/platform';
import { shorten } from 'vs/base/common/labels';
import { EditorResourceAccessor, GroupIdentifier, Verbosity, IEditorPartOptions, SideBySideEditor, DEFAULT_EDITOR_ASSOCIATION, EditorInputCapabilities, IUntypedEditorInput, preventEditorClose, EditorCloseMethod, EditorsOrder, IToolbarActions } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { computeEditorAriaLabel } from 'vs/workbench/browser/editor';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventType as TouchEventType, GestureEvent, Gesture } from 'vs/base/browser/touch';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ResourceLabels, IResourceLabel, DEFAULT_LABELS_CONTAINER } from 'vs/workbench/browser/labels';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MenuId } from 'vs/platform/actions/common/actions';
import { EditorCommandsContextActionRunner, EditorTabsControl } from 'vs/workbench/browser/parts/editor/editorTabsControl';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IDisposable, dispose, DisposableStore, combinedDisposable, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { getOrSet } from 'vs/base/common/map';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { TAB_INACTIVE_BACKGROUND, TAB_ACTIVE_BACKGROUND, TAB_ACTIVE_FOREGROUND, TAB_INACTIVE_FOREGROUND, TAB_BORDER, EDITOR_DRAG_AND_DROP_BACKGROUND, TAB_UNFOCUSED_ACTIVE_FOREGROUND, TAB_UNFOCUSED_INACTIVE_FOREGROUND, TAB_UNFOCUSED_ACTIVE_BACKGROUND, TAB_UNFOCUSED_ACTIVE_BORDER, TAB_ACTIVE_BORDER, TAB_HOVER_BACKGROUND, TAB_HOVER_BORDER, TAB_UNFOCUSED_HOVER_BACKGROUND, TAB_UNFOCUSED_HOVER_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, WORKBENCH_BACKGROUND, TAB_ACTIVE_BORDER_TOP, TAB_UNFOCUSED_ACTIVE_BORDER_TOP, TAB_ACTIVE_MODIFIED_BORDER, TAB_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_BACKGROUND, TAB_HOVER_FOREGROUND, TAB_UNFOCUSED_HOVER_FOREGROUND, EDITOR_GROUP_HEADER_TABS_BORDER, TAB_LAST_PINNED_BORDER } from 'vs/workbench/common/theme';
import { activeContrastBorder, contrastBorder, editorBackground } from 'vs/platform/theme/common/colorRegistry';
import { ResourcesDropHandler, DraggedEditorIdentifier, DraggedEditorGroupIdentifier, extractTreeDropData } from 'vs/workbench/browser/dnd';
import { Color } from 'vs/base/common/color';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { MergeGroupMode, IMergeGroupOptions, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { addDisposableListener, EventType, EventHelper, Dimension, scheduleAtNextAnimationFrame, findParentWithClass, clearNode, DragAndDropObserver, isMouseEvent, getWindow, runWhenWindowIdle } from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { IEditorGroupsView, EditorServiceImpl, IEditorGroupView, IInternalEditorOpenOptions, IEditorPartsView } from 'vs/workbench/browser/parts/editor/editor';
import { CloseOneEditorAction, UnpinEditorAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { assertAllDefined, assertIsDefined } from 'vs/base/common/types';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { basenameOrAuthority } from 'vs/base/common/resources';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IPath, win32, posix } from 'vs/base/common/path';
import { coalesce, insert } from 'vs/base/common/arrays';
import { isHighContrast } from 'vs/platform/theme/common/theme';
import { isSafari } from 'vs/base/browser/browser';
import { equals } from 'vs/base/common/objects';
import { EditorActivation, IEditorOptions } from 'vs/platform/editor/common/editor';
import { UNLOCK_GROUP_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { ITreeViewsDnDService } from 'vs/editor/common/services/treeViewsDndService';
import { DraggedTreeItemsIdentifier } from 'vs/editor/common/services/treeViewsDnd';
import { IEditorResolverService } from 'vs/workbench/services/editor/common/editorResolverService';
import { IEditorTitleControlDimensions } from 'vs/workbench/browser/parts/editor/editorTitleControl';
import { StickyEditorGroupModel, UnstickyEditorGroupModel } from 'vs/workbench/common/editor/filteredEditorGroupModel';
import { IReadonlyEditorGroupModel } from 'vs/workbench/common/editor/editorGroupModel';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

interface IEditorInputLabel {
	readonly editor: EditorInput;

	readonly name?: string;
	description?: string;
	readonly forceDescription?: boolean;
	readonly title?: string;
	readonly ariaLabel?: string;
}

interface IMultiEditorTabsControlLayoutOptions {

	/**
	 * Whether to force revealing the active tab, even when
	 * the dimensions have not changed. This can be the case
	 * when a tab was made active and needs to be revealed.
	 */
	readonly forceRevealActiveTab?: true;
}

interface IScheduledMultiEditorTabsControlLayout extends IDisposable {

	/**
	 * Associated options with the layout call.
	 */
	options?: IMultiEditorTabsControlLayoutOptions;
}

export class MultiEditorTabsControl extends EditorTabsControl {

	private static readonly SCROLLBAR_SIZES = {
		default: 3 as const,
		large: 10 as const
	};

	private static readonly TAB_WIDTH = {
		compact: 38 as const,
		shrink: 80 as const,
		fit: 120 as const
	};

	private static readonly DRAG_OVER_OPEN_TAB_THRESHOLD = 1500;

	private static readonly MOUSE_WHEEL_EVENT_THRESHOLD = 150;
	private static readonly MOUSE_WHEEL_DISTANCE_THRESHOLD = 1.5;

	private titleContainer: HTMLElement | undefined;
	private tabsAndActionsContainer: HTMLElement | undefined;
	private tabsContainer: HTMLElement | undefined;
	private tabsScrollbar: ScrollableElement | undefined;
	private tabSizingFixedDisposables: DisposableStore | undefined;

	private readonly closeEditorAction = this._register(this.instantiationService.createInstance(CloseOneEditorAction, CloseOneEditorAction.ID, CloseOneEditorAction.LABEL));
	private readonly unpinEditorAction = this._register(this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL));

	private readonly tabResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
	private tabLabels: IEditorInputLabel[] = [];
	private activeTabLabel: IEditorInputLabel | undefined;

	private tabActionBars: ActionBar[] = [];
	private tabDisposables: IDisposable[] = [];

	private dimensions: IEditorTitleControlDimensions & { used?: Dimension } = {
		container: Dimension.None,
		available: Dimension.None
	};

	private readonly layoutScheduler = this._register(new MutableDisposable<IScheduledMultiEditorTabsControlLayout>());
	private blockRevealActiveTab: boolean | undefined;

	private path: IPath = isWindows ? win32 : posix;

	private lastMouseWheelEventTime = 0;
	private isMouseOverTabs = false;

	constructor(
		parent: HTMLElement,
		editorPartsView: IEditorPartsView,
		groupsView: IEditorGroupsView,
		groupView: IEditorGroupView,
		tabsModel: IReadonlyEditorGroupModel,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IThemeService themeService: IThemeService,
		@IEditorService private readonly editorService: EditorServiceImpl,
		@IPathService private readonly pathService: IPathService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@ITreeViewsDnDService private readonly treeViewsDragAndDropService: ITreeViewsDnDService,
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService
	) {
		super(parent, editorPartsView, groupsView, groupView, tabsModel, contextMenuService, instantiationService, contextKeyService, keybindingService, notificationService, quickInputService, themeService, editorResolverService);

		// Resolve the correct path library for the OS we are on
		// If we are connected to remote, this accounts for the
		// remote OS.
		(async () => this.path = await this.pathService.path)();

		// React to decorations changing for our resource labels
		this._register(this.tabResourceLabels.onDidChangeDecorations(() => this.doHandleDecorationsChange()));
	}

	protected override create(parent: HTMLElement): void {
		super.create(parent);

		this.titleContainer = parent;

		// Tabs and Actions Container (are on a single row with flex side-by-side)
		this.tabsAndActionsContainer = document.createElement('div');
		this.tabsAndActionsContainer.classList.add('tabs-and-actions-container');
		this.titleContainer.appendChild(this.tabsAndActionsContainer);

		// Tabs Container
		this.tabsContainer = document.createElement('div');
		this.tabsContainer.setAttribute('role', 'tablist');
		this.tabsContainer.draggable = true;
		this.tabsContainer.classList.add('tabs-container');
		this._register(Gesture.addTarget(this.tabsContainer));

		this.tabSizingFixedDisposables = this._register(new DisposableStore());
		this.updateTabSizing(false);

		// Tabs Scrollbar
		this.tabsScrollbar = this.createTabsScrollbar(this.tabsContainer);
		this.tabsAndActionsContainer.appendChild(this.tabsScrollbar.getDomNode());

		// Tabs Container listeners
		this.registerTabsContainerListeners(this.tabsContainer, this.tabsScrollbar);

		// Create Editor Toolbar
		this.createEditorActionsToolBar(this.tabsAndActionsContainer, ['editor-actions']);

		// Set tabs control visibility
		this.updateTabsControlVisibility();
	}

	private createTabsScrollbar(scrollable: HTMLElement): ScrollableElement {
		const tabsScrollbar = this._register(new ScrollableElement(scrollable, {
			horizontal: ScrollbarVisibility.Auto,
			horizontalScrollbarSize: this.getTabsScrollbarSizing(),
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false
		}));

		this._register(tabsScrollbar.onScroll(e => {
			if (e.scrollLeftChanged) {
				scrollable.scrollLeft = e.scrollLeft;
			}
		}));

		return tabsScrollbar;
	}

	private updateTabsScrollbarSizing(): void {
		this.tabsScrollbar?.updateOptions({
			horizontalScrollbarSize: this.getTabsScrollbarSizing()
		});
	}

	private updateTabSizing(fromEvent: boolean): void {
		const [tabsContainer, tabSizingFixedDisposables] = assertAllDefined(this.tabsContainer, this.tabSizingFixedDisposables);

		tabSizingFixedDisposables.clear();

		const options = this.groupsView.partOptions;
		if (options.tabSizing === 'fixed') {
			tabsContainer.style.setProperty('--tab-sizing-fixed-min-width', `${options.tabSizingFixedMinWidth}px`);
			tabsContainer.style.setProperty('--tab-sizing-fixed-max-width', `${options.tabSizingFixedMaxWidth}px`);

			// For https://github.com/microsoft/vscode/issues/40290 we want to
			// preserve the current tab widths as long as the mouse is over the
			// tabs so that you can quickly close them via mouse click. For that
			// we track mouse movements over the tabs container.

			tabSizingFixedDisposables.add(addDisposableListener(tabsContainer, EventType.MOUSE_ENTER, () => {
				this.isMouseOverTabs = true;
			}));
			tabSizingFixedDisposables.add(addDisposableListener(tabsContainer, EventType.MOUSE_LEAVE, () => {
				this.isMouseOverTabs = false;
				this.updateTabsFixedWidth(false);
			}));
		} else if (fromEvent) {
			tabsContainer.style.removeProperty('--tab-sizing-fixed-min-width');
			tabsContainer.style.removeProperty('--tab-sizing-fixed-max-width');
			this.updateTabsFixedWidth(false);
		}
	}

	private updateTabsFixedWidth(fixed: boolean): void {
		this.forEachTab((editor, tabIndex, tabContainer) => {
			if (fixed) {
				const { width } = tabContainer.getBoundingClientRect();
				tabContainer.style.setProperty('--tab-sizing-current-width', `${width}px`);
			} else {
				tabContainer.style.removeProperty('--tab-sizing-current-width');
			}
		});
	}

	private getTabsScrollbarSizing(): number {
		if (this.groupsView.partOptions.titleScrollbarSizing !== 'large') {
			return MultiEditorTabsControl.SCROLLBAR_SIZES.default;
		}

		return MultiEditorTabsControl.SCROLLBAR_SIZES.large;
	}

	private registerTabsContainerListeners(tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): void {

		// Group dragging
		this.enableGroupDragging(tabsContainer);

		// Forward scrolling inside the container to our custom scrollbar
		this._register(addDisposableListener(tabsContainer, EventType.SCROLL, () => {
			if (tabsContainer.classList.contains('scroll')) {
				tabsScrollbar.setScrollPosition({
					scrollLeft: tabsContainer.scrollLeft // during DND the container gets scrolled so we need to update the custom scrollbar
				});
			}
		}));

		// New file when double-clicking on tabs container (but not tabs)
		for (const eventType of [TouchEventType.Tap, EventType.DBLCLICK]) {
			this._register(addDisposableListener(tabsContainer, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					if (e.target !== tabsContainer) {
						return; // ignore if target is not tabs container
					}
				} else {
					if ((<GestureEvent>e).tapCount !== 2) {
						return; // ignore single taps
					}

					if ((<GestureEvent>e).initialTarget !== tabsContainer) {
						return; // ignore if target is not tabs container
					}
				}

				EventHelper.stop(e);

				this.editorService.openEditor({
					resource: undefined,
					options: {
						pinned: true,
						index: this.groupView.count, // always at the end
						override: DEFAULT_EDITOR_ASSOCIATION.id
					}
				}, this.groupView.id);
			}));
		}

		// Prevent auto-scrolling (https://github.com/microsoft/vscode/issues/16690)
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_DOWN, e => {
			if (e.button === 1) {
				e.preventDefault();
			}
		}));

		// Drop support
		this._register(new DragAndDropObserver(tabsContainer, {
			onDragEnter: e => {

				// Always enable support to scroll while dragging
				tabsContainer.classList.add('scroll');

				// Return if the target is not on the tabs container
				if (e.target !== tabsContainer) {
					this.updateDropFeedback(tabsContainer, false); // fixes https://github.com/microsoft/vscode/issues/52093
					return;
				}

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is last tab because then this is a no-op
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (this.groupView.id === localDraggedEditor.groupId && this.tabsModel.isLast(localDraggedEditor.editor)) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tabsContainer, true);
			},

			onDragLeave: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');
			},

			onDragEnd: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');
			},

			onDrop: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');

				if (e.target === tabsContainer) {
					const isGroupTransfer = this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype);
					this.onDrop(e, isGroupTransfer ? this.groupView.count : this.tabsModel.count, tabsContainer);
				}
			}
		}));

		// Mouse-wheel support to switch to tabs optionally
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_WHEEL, (e: WheelEvent) => {
			const activeEditor = this.groupView.activeEditor;
			if (!activeEditor || this.groupView.count < 2) {
				return;  // need at least 2 open editors
			}

			// Shift-key enables or disables this behaviour depending on the setting
			if (this.groupsView.partOptions.scrollToSwitchTabs === true) {
				if (e.shiftKey) {
					return; // 'on': only enable this when Shift-key is not pressed
				}
			} else {
				if (!e.shiftKey) {
					return; // 'off': only enable this when Shift-key is pressed
				}
			}

			// Ignore event if the last one happened too recently (https://github.com/microsoft/vscode/issues/96409)
			// The restriction is relaxed according to the absolute value of `deltaX` and `deltaY`
			// to support discrete (mouse wheel) and contiguous scrolling (touchpad) equally well
			const now = Date.now();
			if (now - this.lastMouseWheelEventTime < MultiEditorTabsControl.MOUSE_WHEEL_EVENT_THRESHOLD - 2 * (Math.abs(e.deltaX) + Math.abs(e.deltaY))) {
				return;
			}

			this.lastMouseWheelEventTime = now;

			// Figure out scrolling direction but ignore it if too subtle
			let tabSwitchDirection: number;
			if (e.deltaX + e.deltaY < - MultiEditorTabsControl.MOUSE_WHEEL_DISTANCE_THRESHOLD) {
				tabSwitchDirection = -1;
			} else if (e.deltaX + e.deltaY > MultiEditorTabsControl.MOUSE_WHEEL_DISTANCE_THRESHOLD) {
				tabSwitchDirection = 1;
			} else {
				return;
			}

			const nextEditor = this.groupView.getEditorByIndex(this.groupView.getIndexOfEditor(activeEditor) + tabSwitchDirection);
			if (!nextEditor) {
				return;
			}

			// Open it
			this.groupView.openEditor(nextEditor);

			// Disable normal scrolling, opening the editor will already reveal it properly
			EventHelper.stop(e, true);
		}));

		// Context menu
		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			// Find target anchor
			let anchor: HTMLElement | StandardMouseEvent = tabsContainer;
			if (isMouseEvent(e)) {
				anchor = new StandardMouseEvent(e);
			}

			// Show it
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				menuId: MenuId.EditorTabsBarContext,
				contextKeyService: this.contextKeyService,
				menuActionOptions: { shouldForwardArgs: true },
				getActionsContext: () => ({ groupId: this.groupView.id }),
				getKeyBinding: action => this.getKeybinding(action),
				onHide: () => this.groupView.focus()
			});
		};

		this._register(addDisposableListener(tabsContainer, TouchEventType.Contextmenu, e => showContextMenu(e)));
		this._register(addDisposableListener(tabsContainer, EventType.CONTEXT_MENU, e => showContextMenu(e)));
	}

	private doHandleDecorationsChange(): void {

		// A change to decorations potentially has an impact on the size of tabs
		// so we need to trigger a layout in that case to adjust things
		this.layout(this.dimensions);
	}

	protected override updateEditorActionsToolbar(): void {
		super.updateEditorActionsToolbar();

		// Changing the actions in the toolbar can have an impact on the size of the
		// tab container, so we need to layout the tabs to make sure the active is visible
		this.layout(this.dimensions);
	}

	openEditor(editor: EditorInput, options?: IInternalEditorOpenOptions): boolean {
		const changed = this.handleOpenedEditors();

		// Respect option to focus tab control if provided
		if (options?.focusTabControl) {
			this.withTab(editor, (editor, tabIndex, tabContainer) => tabContainer.focus());
		}

		return changed;
	}

	openEditors(editors: EditorInput[]): boolean {
		return this.handleOpenedEditors();
	}

	private handleOpenedEditors(): boolean {

		// Set tabs control visibility
		this.updateTabsControlVisibility();

		// Create tabs as needed
		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);
		for (let i = tabsContainer.children.length; i < this.tabsModel.count; i++) {
			tabsContainer.appendChild(this.createTab(i, tabsContainer, tabsScrollbar));
		}

		// Make sure to recompute tab labels and detect
		// if a label change occurred that requires a
		// redraw of tabs.

		const activeEditorChanged = this.didActiveEditorChange();
		const oldActiveTabLabel = this.activeTabLabel;
		const oldTabLabelsLength = this.tabLabels.length;
		this.computeTabLabels();

		// Redraw and update in these cases
		let didChange = false;
		if (
			activeEditorChanged ||													// active editor changed
			oldTabLabelsLength !== this.tabLabels.length ||							// number of tabs changed
			!this.equalsEditorInputLabel(oldActiveTabLabel, this.activeTabLabel)	// active editor label changed
		) {
			this.redraw({ forceRevealActiveTab: true });
			didChange = true;
		}

		// Otherwise only layout for revealing
		else {
			this.layout(this.dimensions, { forceRevealActiveTab: true });
		}

		return didChange;
	}

	private didActiveEditorChange(): boolean {
		if (
			!this.activeTabLabel?.editor && this.tabsModel.activeEditor || 							// active editor changed from null => editor
			this.activeTabLabel?.editor && !this.tabsModel.activeEditor || 							// active editor changed from editor => null
			(!this.activeTabLabel?.editor || !this.tabsModel.isActive(this.activeTabLabel.editor))	// active editor changed from editorA => editorB
		) {
			return true;
		}

		return false;
	}

	private equalsEditorInputLabel(labelA: IEditorInputLabel | undefined, labelB: IEditorInputLabel | undefined): boolean {
		if (labelA === labelB) {
			return true;
		}

		if (!labelA || !labelB) {
			return false;
		}

		return labelA.name === labelB.name &&
			labelA.description === labelB.description &&
			labelA.forceDescription === labelB.forceDescription &&
			labelA.title === labelB.title &&
			labelA.ariaLabel === labelB.ariaLabel;
	}

	beforeCloseEditor(editor: EditorInput): void {

		// Fix tabs width if the mouse is over tabs and before closing
		// a tab (except the last tab) when tab sizing is 'fixed'.
		// This helps keeping the close button stable under
		// the mouse and allows for rapid closing of tabs.

		if (this.isMouseOverTabs && this.groupsView.partOptions.tabSizing === 'fixed') {
			const closingLastTab = this.tabsModel.isLast(editor);
			this.updateTabsFixedWidth(!closingLastTab);
		}
	}

	closeEditor(editor: EditorInput): void {
		this.handleClosedEditors();
	}

	closeEditors(editors: EditorInput[]): void {
		this.handleClosedEditors();
	}

	private handleClosedEditors(): void {

		// There are tabs to show
		if (this.tabsModel.count) {

			// Remove tabs that got closed
			const tabsContainer = assertIsDefined(this.tabsContainer);
			while (tabsContainer.children.length > this.tabsModel.count) {

				// Remove one tab from container (must be the last to keep indexes in order!)
				tabsContainer.lastChild?.remove();

				// Remove associated tab label and widget
				dispose(this.tabDisposables.pop());
			}

			// A removal of a label requires to recompute all labels
			this.computeTabLabels();

			// Redraw all tabs
			this.redraw({ forceRevealActiveTab: true });
		}

		// No tabs to show
		else {
			if (this.tabsContainer) {
				clearNode(this.tabsContainer);
			}

			this.tabDisposables = dispose(this.tabDisposables);
			this.tabResourceLabels.clear();
			this.tabLabels = [];
			this.activeTabLabel = undefined;
			this.tabActionBars = [];

			this.clearEditorActionsToolbar();
			this.updateTabsControlVisibility();
		}
	}

	moveEditor(editor: EditorInput, fromTabIndex: number, targeTabIndex: number): void {

		// Move the editor label
		const editorLabel = this.tabLabels[fromTabIndex];
		this.tabLabels.splice(fromTabIndex, 1);
		this.tabLabels.splice(targeTabIndex, 0, editorLabel);

		// Redraw tabs in the range of the move
		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		},
			Math.min(fromTabIndex, targeTabIndex), 	// from: smallest of fromTabIndex/targeTabIndex
			Math.max(fromTabIndex, targeTabIndex)	//   to: largest of fromTabIndex/targeTabIndex
		);

		// Moving an editor requires a layout to keep the active editor visible
		this.layout(this.dimensions, { forceRevealActiveTab: true });
	}

	pinEditor(editor: EditorInput): void {
		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel) => this.redrawTabLabel(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel));
	}

	stickEditor(editor: EditorInput): void {
		this.doHandleStickyEditorChange(editor);
	}

	unstickEditor(editor: EditorInput): void {
		this.doHandleStickyEditorChange(editor);
	}

	private doHandleStickyEditorChange(editor: EditorInput): void {

		// Update tab
		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar));

		// Sticky change has an impact on each tab's border because
		// it potentially moves the border to the last pinned tab
		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabBorders(tabIndex, tabContainer);
		});

		// A change to the sticky state requires a layout to keep the active editor visible
		this.layout(this.dimensions, { forceRevealActiveTab: true });
	}

	setActive(isGroupActive: boolean): void {

		// Activity has an impact on each tab's active indication
		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTabActiveAndDirty(isGroupActive, editor, tabContainer, tabActionBar);
		});

		// Activity has an impact on the toolbar, so we need to update and layout
		this.updateEditorActionsToolbar();
		this.layout(this.dimensions, { forceRevealActiveTab: true });
	}

	private updateEditorLabelScheduler = this._register(new RunOnceScheduler(() => this.doUpdateEditorLabels(), 0));

	updateEditorLabel(editor: EditorInput): void {

		// Update all labels to account for changes to tab labels
		// Since this method may be called a lot of times from
		// individual editors, we collect all those requests and
		// then run the update once because we have to update
		// all opened tabs in the group at once.
		this.updateEditorLabelScheduler.schedule();
	}

	private doUpdateEditorLabels(): void {

		// A change to a label requires to recompute all labels
		this.computeTabLabels();

		// As such we need to redraw each label
		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabLabel(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel);
		});

		// A change to a label requires a layout to keep the active editor visible
		this.layout(this.dimensions);
	}

	updateEditorDirty(editor: EditorInput): void {
		this.withTab(editor, (editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTabActiveAndDirty(this.groupsView.activeGroup === this.groupView, editor, tabContainer, tabActionBar));
	}

	override updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {
		super.updateOptions(oldOptions, newOptions);

		// A change to a label format options requires to recompute all labels
		if (oldOptions.labelFormat !== newOptions.labelFormat) {
			this.computeTabLabels();
		}

		// Update tabs scrollbar sizing
		if (oldOptions.titleScrollbarSizing !== newOptions.titleScrollbarSizing) {
			this.updateTabsScrollbarSizing();
		}

		// Update tabs sizing
		if (
			oldOptions.tabSizingFixedMinWidth !== newOptions.tabSizingFixedMinWidth ||
			oldOptions.tabSizingFixedMaxWidth !== newOptions.tabSizingFixedMaxWidth ||
			oldOptions.tabSizing !== newOptions.tabSizing
		) {
			this.updateTabSizing(true);
		}

		// Redraw tabs when other options change
		if (
			oldOptions.labelFormat !== newOptions.labelFormat ||
			oldOptions.tabActionLocation !== newOptions.tabActionLocation ||
			oldOptions.tabActionCloseVisibility !== newOptions.tabActionCloseVisibility ||
			oldOptions.tabActionUnpinVisibility !== newOptions.tabActionUnpinVisibility ||
			oldOptions.tabSizing !== newOptions.tabSizing ||
			oldOptions.pinnedTabSizing !== newOptions.pinnedTabSizing ||
			oldOptions.showIcons !== newOptions.showIcons ||
			oldOptions.hasIcons !== newOptions.hasIcons ||
			oldOptions.highlightModifiedTabs !== newOptions.highlightModifiedTabs ||
			oldOptions.wrapTabs !== newOptions.wrapTabs ||
			!equals(oldOptions.decorations, newOptions.decorations)
		) {
			this.redraw();
		}
	}

	override updateStyles(): void {
		this.redraw();
	}

	private forEachTab(fn: (editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void, fromTabIndex?: number, toTabIndex?: number): void {
		this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
			if (typeof fromTabIndex === 'number' && fromTabIndex > tabIndex) {
				return; // do nothing if we are not yet at `fromIndex`
			}

			if (typeof toTabIndex === 'number' && toTabIndex < tabIndex) {
				return; // do nothing if we are beyond `toIndex`
			}

			this.doWithTab(tabIndex, editor, fn);
		});
	}

	private withTab(editor: EditorInput, fn: (editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		this.doWithTab(this.tabsModel.indexOf(editor), editor, fn);
	}

	private doWithTab(tabIndex: number, editor: EditorInput, fn: (editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		const tabsContainer = assertIsDefined(this.tabsContainer);
		const tabContainer = tabsContainer.children[tabIndex] as HTMLElement;
		const tabResourceLabel = this.tabResourceLabels.get(tabIndex);
		const tabLabel = this.tabLabels[tabIndex];
		const tabActionBar = this.tabActionBars[tabIndex];
		if (tabContainer && tabResourceLabel && tabLabel) {
			fn(editor, tabIndex, tabContainer, tabResourceLabel, tabLabel, tabActionBar);
		}
	}

	private createTab(tabIndex: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): HTMLElement {

		// Tab Container
		const tabContainer = document.createElement('div');
		tabContainer.draggable = true;
		tabContainer.setAttribute('role', 'tab');
		tabContainer.classList.add('tab');

		// Gesture Support
		this._register(Gesture.addTarget(tabContainer));

		// Tab Border Top
		const tabBorderTopContainer = document.createElement('div');
		tabBorderTopContainer.classList.add('tab-border-top-container');
		tabContainer.appendChild(tabBorderTopContainer);

		// Tab Editor Label
		const editorLabel = this.tabResourceLabels.create(tabContainer);

		// Tab Actions
		const tabActionsContainer = document.createElement('div');
		tabActionsContainer.classList.add('tab-actions');
		tabContainer.appendChild(tabActionsContainer);

		const that = this;
		const tabActionRunner = new EditorCommandsContextActionRunner({
			groupId: this.groupView.id,
			get editorIndex() { return that.toEditorIndex(tabIndex); }
		});

		const tabActionBar = new ActionBar(tabActionsContainer, { ariaLabel: localize('ariaLabelTabActions', "Tab actions"), actionRunner: tabActionRunner });
		const tabActionListener = tabActionBar.onWillRun(e => {
			if (e.action.id === this.closeEditorAction.id) {
				this.blockRevealActiveTabOnce();
			}
		});

		const tabActionBarDisposable = combinedDisposable(tabActionBar, tabActionListener, toDisposable(insert(this.tabActionBars, tabActionBar)));

		// Tab Border Bottom
		const tabBorderBottomContainer = document.createElement('div');
		tabBorderBottomContainer.classList.add('tab-border-bottom-container');
		tabContainer.appendChild(tabBorderBottomContainer);

		// Eventing
		const eventsDisposable = this.registerTabListeners(tabContainer, tabIndex, tabsContainer, tabsScrollbar);

		this.tabDisposables.push(combinedDisposable(eventsDisposable, tabActionBarDisposable, tabActionRunner, editorLabel));

		return tabContainer;
	}

	private toEditorIndex(tabIndex: number): number {

		// Given a `tabIndex` that is relative to the tabs model
		// returns the `editorIndex` relative to the entire group

		const editor = assertIsDefined(this.tabsModel.getEditorByIndex(tabIndex));

		return this.groupView.getIndexOfEditor(editor);
	}

	private registerTabListeners(tab: HTMLElement, tabIndex: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): IDisposable {
		const disposables = new DisposableStore();

		const handleClickOrTouch = (e: MouseEvent | GestureEvent, preserveFocus: boolean): void => {
			tab.blur(); // prevent flicker of focus outline on tab until editor got focus

			if (isMouseEvent(e) && (e.button !== 0 /* middle/right mouse button */ || (isMacintosh && e.ctrlKey /* macOS context menu */))) {
				if (e.button === 1) {
					e.preventDefault(); // required to prevent auto-scrolling (https://github.com/microsoft/vscode/issues/16690)
				}

				return undefined;
			}

			if (this.originatesFromTabActionBar(e)) {
				return; // not when clicking on actions
			}

			// Open tabs editor
			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (editor) {
				// Even if focus is preserved make sure to activate the group.
				this.groupView.openEditor(editor, { preserveFocus, activation: EditorActivation.ACTIVATE });
			}

			return undefined;
		};

		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (editor) {
				this.onTabContextMenu(editor, e, tab);
			}
		};

		// Open on Click / Touch
		disposables.add(addDisposableListener(tab, EventType.MOUSE_DOWN, e => handleClickOrTouch(e, false)));
		disposables.add(addDisposableListener(tab, TouchEventType.Tap, (e: GestureEvent) => handleClickOrTouch(e, true))); // Preserve focus on touch #125470

		// Touch Scroll Support
		disposables.add(addDisposableListener(tab, TouchEventType.Change, (e: GestureEvent) => {
			tabsScrollbar.setScrollPosition({ scrollLeft: tabsScrollbar.getScrollPosition().scrollLeft - e.translationX });
		}));

		// Prevent flicker of focus outline on tab until editor got focus
		disposables.add(addDisposableListener(tab, EventType.MOUSE_UP, e => {
			EventHelper.stop(e);

			tab.blur();
		}));

		// Close on mouse middle click
		disposables.add(addDisposableListener(tab, EventType.AUXCLICK, e => {
			if (e.button === 1 /* Middle Button*/) {
				EventHelper.stop(e, true /* for https://github.com/microsoft/vscode/issues/56715 */);

				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (editor) {
					if (preventEditorClose(this.tabsModel, editor, EditorCloseMethod.MOUSE, this.groupsView.partOptions)) {
						return;
					}

					this.blockRevealActiveTabOnce();
					this.closeEditorAction.run({ groupId: this.groupView.id, editorIndex: this.groupView.getIndexOfEditor(editor) });
				}
			}
		}));

		// Context menu on Shift+F10
		disposables.add(addDisposableListener(tab, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.shiftKey && event.keyCode === KeyCode.F10) {
				showContextMenu(e);
			}
		}));

		// Context menu on touch context menu gesture
		disposables.add(addDisposableListener(tab, TouchEventType.Contextmenu, (e: GestureEvent) => {
			showContextMenu(e);
		}));

		// Keyboard accessibility
		disposables.add(addDisposableListener(tab, EventType.KEY_UP, e => {
			const event = new StandardKeyboardEvent(e);
			let handled = false;

			// Run action on Enter/Space
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				handled = true;
				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (editor) {
					this.groupView.openEditor(editor);
				}
			}

			// Navigate in editors
			else if ([KeyCode.LeftArrow, KeyCode.RightArrow, KeyCode.UpArrow, KeyCode.DownArrow, KeyCode.Home, KeyCode.End].some(kb => event.equals(kb))) {
				let editorIndex = this.toEditorIndex(tabIndex);
				if (event.equals(KeyCode.LeftArrow) || event.equals(KeyCode.UpArrow)) {
					editorIndex = editorIndex - 1;
				} else if (event.equals(KeyCode.RightArrow) || event.equals(KeyCode.DownArrow)) {
					editorIndex = editorIndex + 1;
				} else if (event.equals(KeyCode.Home)) {
					editorIndex = 0;
				} else {
					editorIndex = this.groupView.count - 1;
				}

				const target = this.groupView.getEditorByIndex(editorIndex);
				if (target) {
					handled = true;
					this.groupView.openEditor(target, { preserveFocus: true }, { focusTabControl: true });
				}
			}

			if (handled) {
				EventHelper.stop(e, true);
			}

			// moving in the tabs container can have an impact on scrolling position, so we need to update the custom scrollbar
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainer.scrollLeft
			});
		}));

		// Double click: either pin or toggle maximized
		for (const eventType of [TouchEventType.Tap, EventType.DBLCLICK]) {
			disposables.add(addDisposableListener(tab, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					EventHelper.stop(e);
				} else if ((<GestureEvent>e).tapCount !== 2) {
					return; // ignore single taps
				}

				const editor = this.tabsModel.getEditorByIndex(tabIndex);
				if (editor && this.tabsModel.isPinned(editor)) {
					switch (this.groupsView.partOptions.doubleClickTabToToggleEditorGroupSizes) {
						case 'maximize':
							this.groupsView.toggleMaximizeGroup(this.groupView);
							break;
						case 'expand':
							this.groupsView.toggleExpandGroup(this.groupView);
							break;
						case 'off':
							break;
					}

				} else {
					this.groupView.pinEditor(editor);
				}
			}));
		}

		// Context menu
		disposables.add(addDisposableListener(tab, EventType.CONTEXT_MENU, e => {
			EventHelper.stop(e, true);

			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (editor) {
				this.onTabContextMenu(editor, e, tab);
			}
		}, true /* use capture to fix https://github.com/microsoft/vscode/issues/19145 */));

		// Drag support
		disposables.add(addDisposableListener(tab, EventType.DRAG_START, e => {
			const editor = this.tabsModel.getEditorByIndex(tabIndex);
			if (!editor) {
				return;
			}

			this.editorTransfer.setData([new DraggedEditorIdentifier({ editor, groupId: this.groupView.id })], DraggedEditorIdentifier.prototype);

			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'copyMove';
			}

			// Apply some datatransfer types to allow for dragging the element outside of the application
			this.doFillResourceDataTransfers([editor], e);

			// Fixes https://github.com/microsoft/vscode/issues/18733
			tab.classList.add('dragged');
			scheduleAtNextAnimationFrame(getWindow(tab), () => tab.classList.remove('dragged'));
		}));

		// Drop support
		disposables.add(new DragAndDropObserver(tab, {
			onDragEnter: e => {

				// Update class to signal drag operation
				tab.classList.add('dragged-over');

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is the current tab dragged over
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (localDraggedEditor.editor === this.tabsModel.getEditorByIndex(tabIndex) && localDraggedEditor.groupId === this.groupView.id) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tab, true, tabIndex);
			},

			onDragOver: (_, dragDuration) => {
				if (dragDuration >= MultiEditorTabsControl.DRAG_OVER_OPEN_TAB_THRESHOLD) {
					const draggedOverTab = this.tabsModel.getEditorByIndex(tabIndex);
					if (draggedOverTab && this.tabsModel.activeEditor !== draggedOverTab) {
						this.groupView.openEditor(draggedOverTab, { preserveFocus: true });
					}
				}
			},

			onDragLeave: () => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, tabIndex);
			},

			onDragEnd: () => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, tabIndex);

				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			},

			onDrop: e => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, tabIndex);

				this.onDrop(e, tabIndex, tabsContainer);
			}
		}));

		return disposables;
	}

	private isSupportedDropTransfer(e: DragEvent): boolean {
		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data)) {
				const group = data[0];
				if (group.identifier === this.groupView.id) {
					return false; // groups cannot be dropped on group it originates from
				}
			}

			return true;
		}

		if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			return true; // (local) editors can always be dropped
		}

		if (e.dataTransfer && e.dataTransfer.types.length > 0) {
			return true; // optimistically allow external data (// see https://github.com/microsoft/vscode/issues/25789)
		}

		return false;
	}

	private updateDropFeedback(element: HTMLElement, isDND: boolean, tabIndex?: number): void {
		const isTab = (typeof tabIndex === 'number');
		const editor = typeof tabIndex === 'number' ? this.tabsModel.getEditorByIndex(tabIndex) : undefined;
		const isActiveTab = isTab && !!editor && this.tabsModel.isActive(editor);

		// Background
		const noDNDBackgroundColor = isTab ? this.getColor(isActiveTab ? TAB_ACTIVE_BACKGROUND : TAB_INACTIVE_BACKGROUND) : '';
		element.style.backgroundColor = (isDND ? this.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND) : noDNDBackgroundColor) || '';

		// Outline
		const activeContrastBorderColor = this.getColor(activeContrastBorder);
		if (activeContrastBorderColor && isDND) {
			element.style.outlineWidth = '2px';
			element.style.outlineStyle = 'dashed';
			element.style.outlineColor = activeContrastBorderColor;
			element.style.outlineOffset = isTab ? '-5px' : '-3px';
		} else {
			element.style.outlineWidth = '';
			element.style.outlineStyle = '';
			element.style.outlineColor = activeContrastBorderColor || '';
			element.style.outlineOffset = '';
		}
	}

	private computeTabLabels(): void {
		const { labelFormat } = this.groupsView.partOptions;
		const { verbosity, shortenDuplicates } = this.getLabelConfigFlags(labelFormat);

		// Build labels and descriptions for each editor
		const labels: IEditorInputLabel[] = [];
		let activeEditorTabIndex = -1;
		this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
			labels.push({
				editor,
				name: editor.getName(),
				description: editor.getDescription(verbosity),
				forceDescription: editor.hasCapability(EditorInputCapabilities.ForceDescription),
				title: editor.getTitle(Verbosity.LONG),
				ariaLabel: computeEditorAriaLabel(editor, tabIndex, this.groupView, this.editorGroupService.count)
			});

			if (editor === this.tabsModel.activeEditor) {
				activeEditorTabIndex = tabIndex;
			}
		});

		// Shorten labels as needed
		if (shortenDuplicates) {
			this.shortenTabLabels(labels);
		}

		// Remember for fast lookup
		this.tabLabels = labels;
		this.activeTabLabel = labels[activeEditorTabIndex];
	}

	private shortenTabLabels(labels: IEditorInputLabel[]): void {

		// Gather duplicate titles, while filtering out invalid descriptions
		const mapNameToDuplicates = new Map<string, IEditorInputLabel[]>();
		for (const label of labels) {
			if (typeof label.description === 'string') {
				getOrSet(mapNameToDuplicates, label.name, []).push(label);
			} else {
				label.description = '';
			}
		}

		// Identify duplicate names and shorten descriptions
		for (const [, duplicateLabels] of mapNameToDuplicates) {

			// Remove description if the title isn't duplicated
			// and we have no indication to enforce description
			if (duplicateLabels.length === 1 && !duplicateLabels[0].forceDescription) {
				duplicateLabels[0].description = '';

				continue;
			}

			// Identify duplicate descriptions
			const mapDescriptionToDuplicates = new Map<string, IEditorInputLabel[]>();
			for (const duplicateLabel of duplicateLabels) {
				getOrSet(mapDescriptionToDuplicates, duplicateLabel.description, []).push(duplicateLabel);
			}

			// For editors with duplicate descriptions, check whether any long descriptions differ
			let useLongDescriptions = false;
			for (const [, duplicateLabels] of mapDescriptionToDuplicates) {
				if (!useLongDescriptions && duplicateLabels.length > 1) {
					const [first, ...rest] = duplicateLabels.map(({ editor }) => editor.getDescription(Verbosity.LONG));
					useLongDescriptions = rest.some(description => description !== first);
				}
			}

			// If so, replace all descriptions with long descriptions
			if (useLongDescriptions) {
				mapDescriptionToDuplicates.clear();
				for (const duplicateLabel of duplicateLabels) {
					duplicateLabel.description = duplicateLabel.editor.getDescription(Verbosity.LONG);
					getOrSet(mapDescriptionToDuplicates, duplicateLabel.description, []).push(duplicateLabel);
				}
			}

			// Obtain final set of descriptions
			const descriptions: string[] = [];
			for (const [description] of mapDescriptionToDuplicates) {
				descriptions.push(description);
			}

			// Remove description if all descriptions are identical unless forced
			if (descriptions.length === 1) {
				for (const label of mapDescriptionToDuplicates.get(descriptions[0]) || []) {
					if (!label.forceDescription) {
						label.description = '';
					}
				}

				continue;
			}

			// Shorten descriptions
			const shortenedDescriptions = shorten(descriptions, this.path.sep);
			descriptions.forEach((description, tabIndex) => {
				for (const label of mapDescriptionToDuplicates.get(description) || []) {
					label.description = shortenedDescriptions[tabIndex];
				}
			});
		}
	}

	private getLabelConfigFlags(value: string | undefined) {
		switch (value) {
			case 'short':
				return { verbosity: Verbosity.SHORT, shortenDuplicates: false };
			case 'medium':
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: false };
			case 'long':
				return { verbosity: Verbosity.LONG, shortenDuplicates: false };
			default:
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: true };
		}
	}

	private redraw(options?: IMultiEditorTabsControlLayoutOptions): void {

		// Border below tabs if any with explicit high contrast support
		if (this.tabsAndActionsContainer) {
			let tabsContainerBorderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER);
			if (!tabsContainerBorderColor && isHighContrast(this.theme.type)) {
				tabsContainerBorderColor = this.getColor(TAB_BORDER) || this.getColor(contrastBorder);
			}

			if (tabsContainerBorderColor) {
				this.tabsAndActionsContainer.classList.add('tabs-border-bottom');
				this.tabsAndActionsContainer.style.setProperty('--tabs-border-bottom-color', tabsContainerBorderColor.toString());
			} else {
				this.tabsAndActionsContainer.classList.remove('tabs-border-bottom');
				this.tabsAndActionsContainer.style.removeProperty('--tabs-border-bottom-color');
			}
		}

		// For each tab
		this.forEachTab((editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTab(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		});

		// Update Editor Actions Toolbar
		this.updateEditorActionsToolbar();

		// Ensure the active tab is always revealed
		this.layout(this.dimensions, options);
	}

	private redrawTab(editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar): void {
		const isTabSticky = this.tabsModel.isSticky(tabIndex);
		const options = this.groupsView.partOptions;

		// Label
		this.redrawTabLabel(editor, tabIndex, tabContainer, tabLabelWidget, tabLabel);

		// Action
		const hasUnpinAction = isTabSticky && options.tabActionUnpinVisibility;
		const hasCloseAction = !hasUnpinAction && options.tabActionCloseVisibility;
		const hasAction = hasUnpinAction || hasCloseAction;

		let tabAction;
		if (hasAction) {
			tabAction = hasUnpinAction ? this.unpinEditorAction : this.closeEditorAction;
		} else {
			// Even if the action is not visible, add it as it contains the dirty indicator
			tabAction = isTabSticky ? this.unpinEditorAction : this.closeEditorAction;
		}

		if (!tabActionBar.hasAction(tabAction)) {
			if (!tabActionBar.isEmpty()) {
				tabActionBar.clear();
			}

			tabActionBar.push(tabAction, { icon: true, label: false, keybinding: this.getKeybindingLabel(tabAction) });
		}

		tabContainer.classList.toggle(`pinned-action-off`, isTabSticky && !hasUnpinAction);
		tabContainer.classList.toggle(`close-action-off`, !hasUnpinAction && !hasCloseAction);

		for (const option of ['left', 'right']) {
			tabContainer.classList.toggle(`tab-actions-${option}`, hasAction && options.tabActionLocation === option);
		}

		const tabSizing = isTabSticky && options.pinnedTabSizing === 'shrink' ? 'shrink' /* treat sticky shrink tabs as tabSizing: 'shrink' */ : options.tabSizing;
		for (const option of ['fit', 'shrink', 'fixed']) {
			tabContainer.classList.toggle(`sizing-${option}`, tabSizing === option);
		}

		tabContainer.classList.toggle('has-icon', options.showIcons && options.hasIcons);

		tabContainer.classList.toggle('sticky', isTabSticky);
		for (const option of ['normal', 'compact', 'shrink']) {
			tabContainer.classList.toggle(`sticky-${option}`, isTabSticky && options.pinnedTabSizing === option);
		}

		// If not wrapping tabs, sticky compact/shrink tabs need a position to remain at their location
		// when scrolling to stay in view (requirement for position: sticky)
		if (!options.wrapTabs && isTabSticky && options.pinnedTabSizing !== 'normal') {
			let stickyTabWidth = 0;
			switch (options.pinnedTabSizing) {
				case 'compact':
					stickyTabWidth = MultiEditorTabsControl.TAB_WIDTH.compact;
					break;
				case 'shrink':
					stickyTabWidth = MultiEditorTabsControl.TAB_WIDTH.shrink;
					break;
			}

			tabContainer.style.left = `${tabIndex * stickyTabWidth}px`;
		} else {
			tabContainer.style.left = 'auto';
		}

		// Borders / outline
		this.redrawTabBorders(tabIndex, tabContainer);

		// Active / dirty state
		this.redrawTabActiveAndDirty(this.groupsView.activeGroup === this.groupView, editor, tabContainer, tabActionBar);
	}

	private redrawTabLabel(editor: EditorInput, tabIndex: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel): void {
		const options = this.groupsView.partOptions;

		// Unless tabs are sticky compact, show the full label and description
		// Sticky compact tabs will only show an icon if icons are enabled
		// or their first character of the name otherwise
		let name: string | undefined;
		let forceLabel = false;
		let fileDecorationBadges = Boolean(options.decorations?.badges);
		let description: string;
		if (options.pinnedTabSizing === 'compact' && this.tabsModel.isSticky(tabIndex)) {
			const isShowingIcons = options.showIcons && options.hasIcons;
			name = isShowingIcons ? '' : tabLabel.name?.charAt(0).toUpperCase();
			description = '';
			forceLabel = true;
			fileDecorationBadges = false; // not enough space when sticky tabs are compact
		} else {
			name = tabLabel.name;
			description = tabLabel.description || '';
		}

		if (tabLabel.ariaLabel) {
			tabContainer.setAttribute('aria-label', tabLabel.ariaLabel);
			// Set aria-description to empty string so that screen readers would not read the title as well
			// More details https://github.com/microsoft/vscode/issues/95378
			tabContainer.setAttribute('aria-description', '');
		}

		const title = tabLabel.title || '';
		tabContainer.title = title;

		// Label
		tabLabelWidget.setResource(
			{ name, description, resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }) },
			{
				title,
				extraClasses: coalesce(['tab-label', fileDecorationBadges ? 'tab-label-has-badge' : undefined].concat(editor.getLabelExtraClasses())),
				italic: !this.tabsModel.isPinned(editor),
				forceLabel,
				fileDecorations: {
					colors: Boolean(options.decorations?.colors),
					badges: fileDecorationBadges
				}
			}
		);

		// Tests helper
		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			tabContainer.setAttribute('data-resource-name', basenameOrAuthority(resource));
		} else {
			tabContainer.removeAttribute('data-resource-name');
		}
	}

	private redrawTabActiveAndDirty(isGroupActive: boolean, editor: EditorInput, tabContainer: HTMLElement, tabActionBar: ActionBar): void {
		const isTabActive = this.tabsModel.isActive(editor);
		const hasModifiedBorderTop = this.doRedrawTabDirty(isGroupActive, isTabActive, editor, tabContainer);

		this.doRedrawTabActive(isGroupActive, !hasModifiedBorderTop, editor, tabContainer, tabActionBar);
	}

	private doRedrawTabActive(isGroupActive: boolean, allowBorderTop: boolean, editor: EditorInput, tabContainer: HTMLElement, tabActionBar: ActionBar): void {

		// Tab is active
		if (this.tabsModel.isActive(editor)) {

			// Container
			tabContainer.classList.add('active');
			tabContainer.setAttribute('aria-selected', 'true');
			tabContainer.tabIndex = 0; // Only active tab can be focused into
			tabContainer.style.backgroundColor = this.getColor(isGroupActive ? TAB_ACTIVE_BACKGROUND : TAB_UNFOCUSED_ACTIVE_BACKGROUND) || '';

			const activeTabBorderColorBottom = this.getColor(isGroupActive ? TAB_ACTIVE_BORDER : TAB_UNFOCUSED_ACTIVE_BORDER);
			if (activeTabBorderColorBottom) {
				tabContainer.classList.add('tab-border-bottom');
				tabContainer.style.setProperty('--tab-border-bottom-color', activeTabBorderColorBottom.toString());
			} else {
				tabContainer.classList.remove('tab-border-bottom');
				tabContainer.style.removeProperty('--tab-border-bottom-color');
			}

			const activeTabBorderColorTop = allowBorderTop ? this.getColor(isGroupActive ? TAB_ACTIVE_BORDER_TOP : TAB_UNFOCUSED_ACTIVE_BORDER_TOP) : undefined;
			if (activeTabBorderColorTop) {
				tabContainer.classList.add('tab-border-top');
				tabContainer.style.setProperty('--tab-border-top-color', activeTabBorderColorTop.toString());
			} else {
				tabContainer.classList.remove('tab-border-top');
				tabContainer.style.removeProperty('--tab-border-top-color');
			}

			// Label
			tabContainer.style.color = this.getColor(isGroupActive ? TAB_ACTIVE_FOREGROUND : TAB_UNFOCUSED_ACTIVE_FOREGROUND) || '';

			// Actions
			tabActionBar.setFocusable(true);
		}

		// Tab is inactive
		else {

			// Container
			tabContainer.classList.remove('active');
			tabContainer.setAttribute('aria-selected', 'false');
			tabContainer.tabIndex = -1; // Only active tab can be focused into
			tabContainer.style.backgroundColor = this.getColor(isGroupActive ? TAB_INACTIVE_BACKGROUND : TAB_UNFOCUSED_INACTIVE_BACKGROUND) || '';
			tabContainer.style.boxShadow = '';

			// Label
			tabContainer.style.color = this.getColor(isGroupActive ? TAB_INACTIVE_FOREGROUND : TAB_UNFOCUSED_INACTIVE_FOREGROUND) || '';

			// Actions
			tabActionBar.setFocusable(false);
		}
	}

	private doRedrawTabDirty(isGroupActive: boolean, isTabActive: boolean, editor: EditorInput, tabContainer: HTMLElement): boolean {
		let hasModifiedBorderColor = false;

		// Tab: dirty (unless saving)
		if (editor.isDirty() && !editor.isSaving()) {
			tabContainer.classList.add('dirty');

			// Highlight modified tabs with a border if configured
			if (this.groupsView.partOptions.highlightModifiedTabs) {
				let modifiedBorderColor: string | null;
				if (isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_ACTIVE_MODIFIED_BORDER);
				} else if (isGroupActive && !isTabActive) {
					modifiedBorderColor = this.getColor(TAB_INACTIVE_MODIFIED_BORDER);
				} else if (!isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER);
				} else {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER);
				}

				if (modifiedBorderColor) {
					hasModifiedBorderColor = true;

					tabContainer.classList.add('dirty-border-top');
					tabContainer.style.setProperty('--tab-dirty-border-top-color', modifiedBorderColor);
				}
			} else {
				tabContainer.classList.remove('dirty-border-top');
				tabContainer.style.removeProperty('--tab-dirty-border-top-color');
			}
		}

		// Tab: not dirty
		else {
			tabContainer.classList.remove('dirty', 'dirty-border-top');
			tabContainer.style.removeProperty('--tab-dirty-border-top-color');
		}

		return hasModifiedBorderColor;
	}

	private redrawTabBorders(tabIndex: number, tabContainer: HTMLElement): void {
		const isTabSticky = this.tabsModel.isSticky(tabIndex);
		const isTabLastSticky = isTabSticky && this.tabsModel.stickyCount === tabIndex + 1;
		const showLastStickyTabBorderColor = this.tabsModel.stickyCount !== this.tabsModel.count;

		// Borders / Outline
		const borderRightColor = ((isTabLastSticky && showLastStickyTabBorderColor ? this.getColor(TAB_LAST_PINNED_BORDER) : undefined) || this.getColor(TAB_BORDER) || this.getColor(contrastBorder));
		tabContainer.style.borderRight = borderRightColor ? `1px solid ${borderRightColor}` : '';
		tabContainer.style.outlineColor = this.getColor(activeContrastBorder) || '';
	}

	protected override prepareEditorActions(editorActions: IToolbarActions): IToolbarActions {
		const isGroupActive = this.groupsView.activeGroup === this.groupView;

		// Active: allow all actions
		if (isGroupActive) {
			return editorActions;
		}

		// Inactive: only show "Unlock" and secondary actions
		else {
			return {
				primary: editorActions.primary.filter(action => action.id === UNLOCK_GROUP_COMMAND_ID),
				secondary: editorActions.secondary
			};
		}
	}

	getHeight(): number {

		// Return quickly if our used dimensions are known
		if (this.dimensions.used) {
			return this.dimensions.used.height;
		}

		// Otherwise compute via browser APIs
		else {
			return this.computeHeight();
		}
	}

	private computeHeight(): number {
		let height: number;

		if (!this.visible) {
			height = 0;
		} else if (this.groupsView.partOptions.wrapTabs && this.tabsAndActionsContainer?.classList.contains('wrapping')) {
			// Wrap: we need to ask `offsetHeight` to get
			// the real height of the title area with wrapping.
			height = this.tabsAndActionsContainer.offsetHeight;
		} else {
			height = this.tabHeight;
		}

		return height;
	}

	layout(dimensions: IEditorTitleControlDimensions, options?: IMultiEditorTabsControlLayoutOptions): Dimension {

		// Remember dimensions that we get
		Object.assign(this.dimensions, dimensions);

		if (this.visible) {
			if (!this.layoutScheduler.value) {

				// The layout of tabs can be an expensive operation because we access DOM properties
				// that can result in the browser doing a full page layout to validate them. To buffer
				// this a little bit we try at least to schedule this work on the next animation frame
				// when we have restored or when idle otherwise.

				const layoutFunction = () => {
					this.doLayout(this.dimensions, this.layoutScheduler.value?.options /* ensure to pick up latest options */);

					this.layoutScheduler.clear();
				};

				let scheduledLayout: IDisposable;
				if (this.lifecycleService.phase >= LifecyclePhase.Restored) {
					scheduledLayout = scheduleAtNextAnimationFrame(getWindow(this.tabsContainer), layoutFunction);
				} else {
					scheduledLayout = runWhenWindowIdle(getWindow(this.tabsContainer), layoutFunction);
				}

				this.layoutScheduler.value = { options, dispose: () => scheduledLayout.dispose() };
			}

			// Make sure to keep options updated
			if (options?.forceRevealActiveTab) {
				this.layoutScheduler.value.options = {
					...this.layoutScheduler.value.options,
					forceRevealActiveTab: true
				};
			}
		}

		// First time layout: compute the dimensions and store it
		if (!this.dimensions.used) {
			this.dimensions.used = new Dimension(dimensions.container.width, this.computeHeight());
		}

		return this.dimensions.used;
	}

	private doLayout(dimensions: IEditorTitleControlDimensions, options?: IMultiEditorTabsControlLayoutOptions): void {

		// Layout tabs
		if (dimensions.container !== Dimension.None && dimensions.available !== Dimension.None) {
			this.doLayoutTabs(dimensions, options);
		}

		// Remember the dimensions used in the control so that we can
		// return it fast from the `layout` call without having to
		// compute it over and over again
		const oldDimension = this.dimensions.used;
		const newDimension = this.dimensions.used = new Dimension(dimensions.container.width, this.computeHeight());

		// In case the height of the title control changed from before
		// (currently only possible if wrapping changed on/off), we need
		// to signal this to the outside via a `relayout` call so that
		// e.g. the editor control can be adjusted accordingly.
		if (oldDimension && oldDimension.height !== newDimension.height) {
			this.groupView.relayout();
		}
	}

	private doLayoutTabs(dimensions: IEditorTitleControlDimensions, options?: IMultiEditorTabsControlLayoutOptions): void {

		// Always first layout tabs with wrapping support even if wrapping
		// is disabled. The result indicates if tabs wrap and if not, we
		// need to proceed with the layout without wrapping because even
		// if wrapping is enabled in settings, there are cases where
		// wrapping is disabled (e.g. due to space constraints)
		const tabsWrapMultiLine = this.doLayoutTabsWrapping(dimensions);
		if (!tabsWrapMultiLine) {
			this.doLayoutTabsNonWrapping(options);
		}
	}

	private doLayoutTabsWrapping(dimensions: IEditorTitleControlDimensions): boolean {
		const [tabsAndActionsContainer, tabsContainer, editorToolbarContainer, tabsScrollbar] = assertAllDefined(this.tabsAndActionsContainer, this.tabsContainer, this.editorActionsToolbarContainer, this.tabsScrollbar);

		// Handle wrapping tabs according to setting:
		// - enabled: only add class if tabs wrap and don't exceed available dimensions
		// - disabled: remove class and margin-right variable

		const didTabsWrapMultiLine = tabsAndActionsContainer.classList.contains('wrapping');
		let tabsWrapMultiLine = didTabsWrapMultiLine;

		function updateTabsWrapping(enabled: boolean): void {
			tabsWrapMultiLine = enabled;

			// Toggle the `wrapped` class to enable wrapping
			tabsAndActionsContainer.classList.toggle('wrapping', tabsWrapMultiLine);

			// Update `last-tab-margin-right` CSS variable to account for the absolute
			// positioned editor actions container when tabs wrap. The margin needs to
			// be the width of the editor actions container to avoid screen cheese.
			tabsContainer.style.setProperty('--last-tab-margin-right', tabsWrapMultiLine ? `${editorToolbarContainer.offsetWidth}px` : '0');
		}

		// Setting enabled: selectively enable wrapping if possible
		if (this.groupsView.partOptions.wrapTabs) {
			const visibleTabsWidth = tabsContainer.offsetWidth;
			const allTabsWidth = tabsContainer.scrollWidth;
			const lastTabFitsWrapped = () => {
				const lastTab = this.getLastTab();
				if (!lastTab) {
					return true; // no tab always fits
				}

				const lastTabOverlapWithToolbarWidth = lastTab.offsetWidth + editorToolbarContainer.offsetWidth - dimensions.available.width;
				if (lastTabOverlapWithToolbarWidth > 1) {
					// Allow for slight rounding errors related to zooming here
					// https://github.com/microsoft/vscode/issues/116385
					return false;
				}

				return true;
			};

			// If tabs wrap or should start to wrap (when width exceeds visible width)
			// we must trigger `updateWrapping` to set the `last-tab-margin-right`
			// accordingly based on the number of actions. The margin is important to
			// properly position the last tab apart from the actions
			//
			// We already check here if the last tab would fit when wrapped given the
			// editor toolbar will also show right next to it. This ensures we are not
			// enabling wrapping only to disable it again in the code below (this fixes
			// flickering issue https://github.com/microsoft/vscode/issues/115050)
			if (tabsWrapMultiLine || (allTabsWidth > visibleTabsWidth && lastTabFitsWrapped())) {
				updateTabsWrapping(true);
			}

			// Tabs wrap multiline: remove wrapping under certain size constraint conditions
			if (tabsWrapMultiLine) {
				if (
					(tabsContainer.offsetHeight > dimensions.available.height) ||							// if height exceeds available height
					(allTabsWidth === visibleTabsWidth && tabsContainer.offsetHeight === this.tabHeight) ||	// if wrapping is not needed anymore
					(!lastTabFitsWrapped())																	// if last tab does not fit anymore
				) {
					updateTabsWrapping(false);
				}
			}
		}

		// Setting disabled: remove CSS traces only if tabs did wrap
		else if (didTabsWrapMultiLine) {
			updateTabsWrapping(false);
		}

		// If we transitioned from non-wrapping to wrapping, we need
		// to update the scrollbar to have an equal `width` and
		// `scrollWidth`. Otherwise a scrollbar would appear which is
		// never desired when wrapping.
		if (tabsWrapMultiLine && !didTabsWrapMultiLine) {
			const visibleTabsWidth = tabsContainer.offsetWidth;
			tabsScrollbar.setScrollDimensions({
				width: visibleTabsWidth,
				scrollWidth: visibleTabsWidth
			});
		}

		// Update the `last-in-row` class on tabs when wrapping
		// is enabled (it doesn't do any harm otherwise). This
		// class controls additional properties of tab when it is
		// the last tab in a row
		if (tabsWrapMultiLine) {

			// Using a map here to change classes after the for loop is
			// crucial for performance because changing the class on a
			// tab can result in layouts of the rendering engine.
			const tabs = new Map<HTMLElement, boolean /* last in row */>();

			let currentTabsPosY: number | undefined = undefined;
			let lastTab: HTMLElement | undefined = undefined;
			for (const child of tabsContainer.children) {
				const tab = child as HTMLElement;
				const tabPosY = tab.offsetTop;

				// Marks a new or the first row of tabs
				if (tabPosY !== currentTabsPosY) {
					currentTabsPosY = tabPosY;
					if (lastTab) {
						tabs.set(lastTab, true); // previous tab must be last in row then
					}
				}

				// Always remember last tab and ensure the
				// last-in-row class is not present until
				// we know the tab is last
				lastTab = tab;
				tabs.set(tab, false);
			}

			// Last tab overally is always last-in-row
			if (lastTab) {
				tabs.set(lastTab, true);
			}

			for (const [tab, lastInRow] of tabs) {
				tab.classList.toggle('last-in-row', lastInRow);
			}
		}

		return tabsWrapMultiLine;
	}

	private doLayoutTabsNonWrapping(options?: IMultiEditorTabsControlLayoutOptions): void {
		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);

		//
		// Synopsis
		// - allTabsWidth:   			sum of all tab widths
		// - stickyTabsWidth:			sum of all sticky tab widths (unless `pinnedTabSizing: normal`)
		// - visibleContainerWidth: 	size of tab container
		// - availableContainerWidth: 	size of tab container minus size of sticky tabs
		//
		// [------------------------------ All tabs width ---------------------------------------]
		// [------------------- Visible container width -------------------]
		//                         [------ Available container width ------]
		// [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                 Active Tab Width [-------]
		// [------- Active Tab Pos X -------]
		// [-- Sticky Tabs Width --]
		//

		const visibleTabsWidth = tabsContainer.offsetWidth;
		const allTabsWidth = tabsContainer.scrollWidth;

		// Compute width of sticky tabs depending on pinned tab sizing
		// - compact: sticky-tabs * TAB_SIZES.compact
		// -  shrink: sticky-tabs * TAB_SIZES.shrink
		// -  normal: 0 (sticky tabs inherit look and feel from non-sticky tabs)
		let stickyTabsWidth = 0;
		if (this.tabsModel.stickyCount > 0) {
			let stickyTabWidth = 0;
			switch (this.groupsView.partOptions.pinnedTabSizing) {
				case 'compact':
					stickyTabWidth = MultiEditorTabsControl.TAB_WIDTH.compact;
					break;
				case 'shrink':
					stickyTabWidth = MultiEditorTabsControl.TAB_WIDTH.shrink;
					break;
			}

			stickyTabsWidth = this.tabsModel.stickyCount * stickyTabWidth;
		}

		const activeTabAndIndex = this.tabsModel.activeEditor ? this.getTabAndIndex(this.tabsModel.activeEditor) : undefined;
		const [activeTab, activeTabIndex] = activeTabAndIndex ?? [undefined, undefined];

		// Figure out if active tab is positioned static which has an
		// impact on whether to reveal the tab or not later
		let activeTabPositionStatic = this.groupsView.partOptions.pinnedTabSizing !== 'normal' && typeof activeTabIndex === 'number' && this.tabsModel.isSticky(activeTabIndex);

		// Special case: we have sticky tabs but the available space for showing tabs
		// is little enough that we need to disable sticky tabs sticky positioning
		// so that tabs can be scrolled at naturally.
		let availableTabsContainerWidth = visibleTabsWidth - stickyTabsWidth;
		if (this.tabsModel.stickyCount > 0 && availableTabsContainerWidth < MultiEditorTabsControl.TAB_WIDTH.fit) {
			tabsContainer.classList.add('disable-sticky-tabs');

			availableTabsContainerWidth = visibleTabsWidth;
			stickyTabsWidth = 0;
			activeTabPositionStatic = false;
		} else {
			tabsContainer.classList.remove('disable-sticky-tabs');
		}

		let activeTabPosX: number | undefined;
		let activeTabWidth: number | undefined;

		if (!this.blockRevealActiveTab && activeTab) {
			activeTabPosX = activeTab.offsetLeft;
			activeTabWidth = activeTab.offsetWidth;
		}

		// Update scrollbar
		const { width: oldVisibleTabsWidth, scrollWidth: oldAllTabsWidth } = tabsScrollbar.getScrollDimensions();
		tabsScrollbar.setScrollDimensions({
			width: visibleTabsWidth,
			scrollWidth: allTabsWidth
		});
		const dimensionsChanged = oldVisibleTabsWidth !== visibleTabsWidth || oldAllTabsWidth !== allTabsWidth;

		// Revealing the active tab is skipped under some conditions:
		if (
			this.blockRevealActiveTab ||							// explicitly disabled
			typeof activeTabPosX !== 'number' ||					// invalid dimension
			typeof activeTabWidth !== 'number' ||					// invalid dimension
			activeTabPositionStatic ||								// static tab (sticky)
			(!dimensionsChanged && !options?.forceRevealActiveTab) 	// dimensions did not change and we have low layout priority (https://github.com/microsoft/vscode/issues/133631)
		) {
			this.blockRevealActiveTab = false;
			return;
		}

		// Reveal the active one
		const tabsContainerScrollPosX = tabsScrollbar.getScrollPosition().scrollLeft;
		const activeTabFits = activeTabWidth <= availableTabsContainerWidth;
		const adjustedActiveTabPosX = activeTabPosX - stickyTabsWidth;

		//
		// Synopsis
		// - adjustedActiveTabPosX: the adjusted tabPosX takes the width of sticky tabs into account
		//   conceptually the scrolling only begins after sticky tabs so in order to reveal a tab fully
		//   the actual position needs to be adjusted for sticky tabs.
		//
		// Tab is overflowing to the right: Scroll minimally until the element is fully visible to the right
		// Note: only try to do this if we actually have enough width to give to show the tab fully!
		//
		// Example: Tab G should be made active and needs to be fully revealed as such.
		//
		// [-------------------------------- All tabs width -----------------------------------------]
		// [-------------------- Visible container width --------------------]
		//                           [----- Available container width -------]
		//     [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                     Active Tab Width [-------]
		//     [------- Active Tab Pos X -------]
		//                             [-------- Adjusted Tab Pos X -------]
		//     [-- Sticky Tabs Width --]
		//
		//
		if (activeTabFits && tabsContainerScrollPosX + availableTabsContainerWidth < adjustedActiveTabPosX + activeTabWidth) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainerScrollPosX + ((adjustedActiveTabPosX + activeTabWidth) /* right corner of tab */ - (tabsContainerScrollPosX + availableTabsContainerWidth) /* right corner of view port */)
			});
		}

		//
		// Tab is overlflowing to the left or does not fit: Scroll it into view to the left
		//
		// Example: Tab C should be made active and needs to be fully revealed as such.
		//
		// [----------------------------- All tabs width ----------------------------------------]
		//     [------------------ Visible container width ------------------]
		//                           [----- Available container width -------]
		// [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                 Active Tab Width [-------]
		// [------- Active Tab Pos X -------]
		//      Adjusted Tab Pos X []
		// [-- Sticky Tabs Width --]
		//
		//
		else if (tabsContainerScrollPosX > adjustedActiveTabPosX || !activeTabFits) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: adjustedActiveTabPosX
			});
		}
	}

	private updateTabsControlVisibility(): void {
		const tabsAndActionsContainer = assertIsDefined(this.tabsAndActionsContainer);
		tabsAndActionsContainer.classList.toggle('empty', !this.visible);

		// Reset dimensions if hidden
		if (!this.visible && this.dimensions) {
			this.dimensions.used = undefined;
		}
	}

	private get visible(): boolean {
		return this.tabsModel.count > 0;
	}

	private getTabAndIndex(editor: EditorInput): [HTMLElement, number /* index */] | undefined {
		const tabIndex = this.tabsModel.indexOf(editor);
		const tab = this.getTabAtIndex(tabIndex);
		if (tab) {
			return [tab, tabIndex];
		}

		return undefined;
	}

	private getTabAtIndex(tabIndex: number): HTMLElement | undefined {
		if (tabIndex >= 0) {
			const tabsContainer = assertIsDefined(this.tabsContainer);

			return tabsContainer.children[tabIndex] as HTMLElement | undefined;
		}

		return undefined;
	}

	private getLastTab(): HTMLElement | undefined {
		return this.getTabAtIndex(this.tabsModel.count - 1);
	}

	private blockRevealActiveTabOnce(): void {

		// When closing tabs through the tab close button or gesture, the user
		// might want to rapidly close tabs in sequence and as such revealing
		// the active tab after each close would be annoying. As such we block
		// the automated revealing of the active tab once after the close is
		// triggered.
		this.blockRevealActiveTab = true;
	}

	private originatesFromTabActionBar(e: MouseEvent | GestureEvent): boolean {
		let element: HTMLElement;
		if (isMouseEvent(e)) {
			element = (e.target || e.srcElement) as HTMLElement;
		} else {
			element = (e as GestureEvent).initialTarget as HTMLElement;
		}

		return !!findParentWithClass(element, 'action-item', 'tab');
	}

	private async onDrop(e: DragEvent, targetTabIndex: number, tabsContainer: HTMLElement): Promise<void> {
		EventHelper.stop(e, true);

		this.updateDropFeedback(tabsContainer, false);
		tabsContainer.classList.remove('scroll');

		const targetEditorIndex = this.tabsModel instanceof UnstickyEditorGroupModel ? targetTabIndex + this.groupView.stickyCount : targetTabIndex;
		const options: IEditorOptions = {
			sticky: this.tabsModel instanceof StickyEditorGroupModel && this.tabsModel.stickyCount === targetEditorIndex,
			index: targetEditorIndex
		};

		// Check for group transfer
		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data)) {
				const sourceGroup = this.editorPartsView.getGroup(data[0].identifier);
				if (sourceGroup) {
					const mergeGroupOptions: IMergeGroupOptions = { index: targetEditorIndex };
					if (!this.isMoveOperation(e, sourceGroup.id)) {
						mergeGroupOptions.mode = MergeGroupMode.COPY_EDITORS;
					}

					this.groupsView.mergeGroup(sourceGroup, this.groupView, mergeGroupOptions);
				}

				this.groupView.focus();
				this.groupTransfer.clearData(DraggedEditorGroupIdentifier.prototype);
			}
		}

		// Check for editor transfer
		else if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
			if (Array.isArray(data)) {
				const draggedEditor = data[0].identifier;
				const sourceGroup = this.editorPartsView.getGroup(draggedEditor.groupId);
				if (sourceGroup) {

					// Move editor to target position and index
					if (this.isMoveOperation(e, draggedEditor.groupId, draggedEditor.editor)) {
						sourceGroup.moveEditor(draggedEditor.editor, this.groupView, options);
					}

					// Copy editor to target position and index
					else {
						sourceGroup.copyEditor(draggedEditor.editor, this.groupView, options);
					}
				}

				this.groupView.focus();
				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			}
		}

		// Check for tree items
		else if (this.treeItemsTransfer.hasData(DraggedTreeItemsIdentifier.prototype)) {
			const data = this.treeItemsTransfer.getData(DraggedTreeItemsIdentifier.prototype);
			if (Array.isArray(data)) {
				const editors: IUntypedEditorInput[] = [];
				for (const id of data) {
					const dataTransferItem = await this.treeViewsDragAndDropService.removeDragOperationTransfer(id.identifier);
					if (dataTransferItem) {
						const treeDropData = await extractTreeDropData(dataTransferItem);
						editors.push(...treeDropData.map(editor => ({ ...editor, options: { ...editor.options, pinned: true, index: targetEditorIndex } })));
					}
				}

				this.editorService.openEditors(editors, this.groupView, { validateTrust: true });
			}

			this.treeItemsTransfer.clearData(DraggedTreeItemsIdentifier.prototype);
		}

		// Check for URI transfer
		else {
			const dropHandler = this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false });
			dropHandler.handleDrop(e, getWindow(this.titleContainer), () => this.groupView, () => this.groupView.focus(), options);
		}
	}

	private isMoveOperation(e: DragEvent, sourceGroup: GroupIdentifier, sourceEditor?: EditorInput) {
		if (sourceEditor?.hasCapability(EditorInputCapabilities.Singleton)) {
			return true; // Singleton editors cannot be split
		}

		const isCopy = (e.ctrlKey && !isMacintosh) || (e.altKey && isMacintosh);

		return (!isCopy || sourceGroup === this.groupView.id);
	}

	override dispose(): void {
		super.dispose();

		this.tabDisposables = dispose(this.tabDisposables);
	}
}

registerThemingParticipant((theme, collector) => {

	// Add bottom border to tabs when wrapping
	const borderColor = theme.getColor(TAB_BORDER);
	if (borderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title > .tabs-and-actions-container.wrapping .tabs-container > .tab {
				border-bottom: 1px solid ${borderColor};
			}
		`);
	}

	// Styling with Outline color (e.g. high contrast theme)
	const activeContrastBorderColor = theme.getColor(activeContrastBorder);
	if (activeContrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab.active,
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab.active:hover  {
				outline: 1px solid;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab.active:focus {
				outline-style: dashed;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active {
				outline: 1px dotted;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				outline: 1px dashed;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active:hover > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.dirty > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.sticky > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover > .tab-actions .action-label {
				opacity: 1 !important;
			}
		`);
	}

	// High Contrast Border Color for Editor Actions
	const contrastBorderColor = theme.getColor(contrastBorder);
	if (contrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .editor-actions {
				outline: 1px solid ${contrastBorderColor}
			}
		`);
	}

	// Hover Background
	const tabHoverBackground = theme.getColor(TAB_HOVER_BACKGROUND);
	if (tabHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				background-color: ${tabHoverBackground} !important;
			}
		`);
	}

	const tabUnfocusedHoverBackground = theme.getColor(TAB_UNFOCUSED_HOVER_BACKGROUND);
	if (tabUnfocusedHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				background-color: ${tabUnfocusedHoverBackground} !important;
			}
		`);
	}

	// Hover Foreground
	const tabHoverForeground = theme.getColor(TAB_HOVER_FOREGROUND);
	if (tabHoverForeground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				color: ${tabHoverForeground} !important;
			}
		`);
	}

	const tabUnfocusedHoverForeground = theme.getColor(TAB_UNFOCUSED_HOVER_FOREGROUND);
	if (tabUnfocusedHoverForeground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				color: ${tabUnfocusedHoverForeground} !important;
			}
		`);
	}

	// Hover Border
	//
	// Unfortunately we need to copy a lot of CSS over from the
	// multiEditorTabsControl.css because we want to reuse the same
	// styles we already have for the normal bottom-border.
	const tabHoverBorder = theme.getColor(TAB_HOVER_BORDER);
	if (tabHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover > .tab-border-bottom-container {
				display: block;
				position: absolute;
				left: 0;
				pointer-events: none;
				width: 100%;
				z-index: 10;
				bottom: 0;
				height: 1px;
				background-color: ${tabHoverBorder};
			}
		`);
	}

	const tabUnfocusedHoverBorder = theme.getColor(TAB_UNFOCUSED_HOVER_BORDER);
	if (tabUnfocusedHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover > .tab-border-bottom-container  {
				display: block;
				position: absolute;
				left: 0;
				pointer-events: none;
				width: 100%;
				z-index: 10;
				bottom: 0;
				height: 1px;
				background-color: ${tabUnfocusedHoverBorder};
			}
		`);
	}

	// Fade out styles via linear gradient (when tabs are set to shrink or fixed)
	// But not when:
	// - in high contrast theme
	// - if we have a contrast border (which draws an outline - https://github.com/microsoft/vscode/issues/109117)
	// - on Safari (https://github.com/microsoft/vscode/issues/108996)
	if (!isHighContrast(theme.type) && !isSafari && !activeContrastBorderColor) {
		const workbenchBackground = WORKBENCH_BACKGROUND(theme);
		const editorBackgroundColor = theme.getColor(editorBackground);
		const editorGroupHeaderTabsBackground = theme.getColor(EDITOR_GROUP_HEADER_TABS_BACKGROUND);
		const editorDragAndDropBackground = theme.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND);

		let adjustedTabBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor) {
			adjustedTabBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorBackgroundColor, workbenchBackground);
		}

		let adjustedTabDragBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor && editorDragAndDropBackground && editorBackgroundColor) {
			adjustedTabDragBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorDragAndDropBackground, editorBackgroundColor, workbenchBackground);
		}

		// Adjust gradient for focused and unfocused hover background
		const makeTabHoverBackgroundRule = (color: Color, colorDrag: Color, hasFocus = false) => `
			.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after,
			.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-fixed:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after {
				background: linear-gradient(to left, ${color}, transparent) !important;
			}

			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after,
			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-fixed:not(.dragged):not(.sticky-compact):hover > .tab-label > .monaco-icon-label-container::after {
				background: linear-gradient(to left, ${colorDrag}, transparent) !important;
			}
		`;

		// Adjust gradient for (focused) hover background
		if (tabHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag, true));
		}

		// Adjust gradient for unfocused hover background
		if (tabUnfocusedHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag));
		}

		// Adjust gradient for drag and drop background
		if (editorDragAndDropBackground && adjustedTabDragBackground) {
			const adjustedColorDrag = editorDragAndDropBackground.flatten(adjustedTabDragBackground);
			collector.addRule(`
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container.active > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.active):not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container:not(.active) > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container.active > .title .tabs-container > .tab.sizing-fixed.dragged-over:not(.active):not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container:not(.active) > .title .tabs-container > .tab.sizing-fixed.dragged-over:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after {
					background: linear-gradient(to left, ${adjustedColorDrag}, transparent) !important;
				}
		`);
		}

		const makeTabBackgroundRule = (color: Color, colorDrag: Color, focused: boolean, active: boolean) => `
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-fixed${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after {
					background: linear-gradient(to left, ${color}, transparent);
				}

				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-fixed${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label > .monaco-icon-label-container::after {
					background: linear-gradient(to left, ${colorDrag}, transparent);
				}
		`;

		// Adjust gradient for focused active tab background
		const tabActiveBackground = theme.getColor(TAB_ACTIVE_BACKGROUND);
		if (tabActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, true, true));
		}

		// Adjust gradient for unfocused active tab background
		const tabUnfocusedActiveBackground = theme.getColor(TAB_UNFOCUSED_ACTIVE_BACKGROUND);
		if (tabUnfocusedActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, false, true));
		}

		// Adjust gradient for focused inactive tab background
		const tabInactiveBackground = theme.getColor(TAB_INACTIVE_BACKGROUND);
		if (tabInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, true, false));
		}

		// Adjust gradient for unfocused inactive tab background
		const tabUnfocusedInactiveBackground = theme.getColor(TAB_UNFOCUSED_INACTIVE_BACKGROUND);
		if (tabUnfocusedInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, false, false));
		}
	}
});
