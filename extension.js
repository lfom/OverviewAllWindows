const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Overview = imports.ui.overview;
const Tweener = imports.ui.tweener;
const Workspace = imports.ui.workspace;
const WorkspacesView = imports.ui.workspacesView;

const Lang = imports.lang;

const ShellVersion = imports.misc.config.PACKAGE_VERSION.split(".").map(function (x) { return + x; });

let currentExtension = imports.misc.extensionUtils.getCurrentExtension();
const UnifiedWorkspacesView10 = currentExtension.imports.unifiedWorkspacesView10;
const UnifiedWorkspacesView12 = currentExtension.imports.unifiedWorkspacesView12;
const UnifiedWorkspacesView14 = currentExtension.imports.unifiedWorkspacesView14;

let _updateWindowPositions = function(flags) {
    if (this._currentLayout == null) {
        this._recalculateWindowPositions(flags);
        return;
    }

    let initialPositioning = flags & Workspace.WindowPositionFlags.INITIAL;
    let animate = flags & Workspace.WindowPositionFlags.ANIMATE;

    let layout = this._currentLayout;
    let strategy = layout.strategy;

    let [, , padding] = this._getSpacingAndPadding();
    let area = Workspace.padArea(this._actualGeometry, padding);
    let slots = strategy.computeWindowSlots(layout, area);

    let currentWorkspace = global.screen.get_active_workspace();

    for (let i = 0; i < slots.length; i++) {
        let slot = slots[i];
        let [x, y, scale, clone] = slot;
        let metaWindow = clone.metaWindow;
        let overlay = clone.overlay;
        clone.slotId = i;

        // Positioning a window currently being dragged must be avoided;
        // we'll just leave a blank spot in the layout for it.
        if (clone.inDrag)
            continue;

        let cloneWidth = clone.actor.width * scale;
        let cloneHeight = clone.actor.height * scale;
        clone.slot = [x, y, cloneWidth, cloneHeight];

        if (overlay && (initialPositioning || !clone.positioned))
            overlay.hide();

        if (!clone.positioned) {
            // This window appeared after the overview was already up
            // Grow the clone from the center of the slot
            clone.actor.x = x + cloneWidth / 2;
            clone.actor.y = y + cloneHeight / 2;
            clone.actor.scale_x = 0;
            clone.actor.scale_y = 0;
            clone.positioned = true;
        }

        if (animate) {
            if (!metaWindow.showing_on_its_workspace() || metaWindow.get_workspace() != currentWorkspace) {
                /* Hidden windows should fade in and grow
                 * therefore we need to resize them now so they
                 * can be scaled up later */
                if (initialPositioning) {
                    clone.actor.opacity = 0;
                    clone.actor.scale_x = 0;
                    clone.actor.scale_y = 0;
                    clone.actor.x = x + cloneWidth / 2;
                    clone.actor.y = y + cloneHeight / 2;
                }

                Tweener.addTween(clone.actor,
                                 { opacity: 255,
                                   time: Overview.ANIMATION_TIME,
                                   transition: 'easeInQuad'
                                 });
            }

            this._animateClone(clone, overlay, x, y, scale, initialPositioning);
        } else {
            // cancel any active tweens (otherwise they might override our changes)
            Tweener.removeTweens(clone.actor);
            clone.actor.set_position(x, y);
            clone.actor.set_scale(scale, scale);
            clone.actor.set_opacity(255);
            clone.overlay.relayout(false);
            this._showWindowOverlay(clone, overlay);
        }
    }
};

// Animates the return from Overview mode in Workspace.Workspace
let zoomFromOverview = function() {
    let currentWorkspace = global.screen.get_active_workspace();

    this.leavingOverview = true;

    for (let i = 0; i < this._windows.length; i++) {
        let clone = this._windows[i];
        Tweener.removeTweens(clone.actor);
    }

    if (this._repositionWindowsId > 0) {
        Mainloop.source_remove(this._repositionWindowsId);
        this._repositionWindowsId = 0;
    }
    this._overviewHiddenId = Main.overview.connect('hidden', Lang.bind(this,
                                                                       this._doneLeavingOverview));

    // Position and scale the windows.
    for (let i = 0; i < this._windows.length; i++) {
        let clone = this._windows[i];
        let overlay = this._windowOverlays[i];

        if (overlay)
            overlay.hide();

        if (clone.metaWindow.showing_on_its_workspace() && clone.metaWindow.get_workspace() == currentWorkspace) {
            let origX, origY;
            if (ShellVersion[1] === 12) {
                [origX, origY] = clone.getOriginalPosition();
            } else {
                origX = clone.origX;
                origY = clone.origY;
            }
            
            Tweener.addTween(clone.actor,
                             { x: origX,
                               y: origY,
                               scale_x: 1.0,
                               scale_y: 1.0,
                               time: Overview.ANIMATION_TIME,
                               opacity: 255,
                               transition: 'easeOutQuad'
                             });
        } else {
            // The window is hidden, make it shrink and fade it out
            Tweener.addTween(clone.actor,
                             { scale_x: 0,
                               scale_y: 0,
                               opacity: 0,
                               time: Overview.ANIMATION_TIME,
                               transition: 'easeOutQuad'
                             });
        }
    }
};

let originalFunctions, originalWorkspacesView;

function init() {
    //nothing here for now
}

function enable() {
    originalFunctions = {};

    originalFunctions['_onCloneSelected'] = Workspace.Workspace.prototype['_onCloneSelected'];
    Workspace.Workspace.prototype['_onCloneSelected'] = function(clone, time) {Main.activateWindow(clone.metaWindow, time)};

    originalFunctions['_isMyWindow'] = Workspace.Workspace.prototype['_isMyWindow'];
    Workspace.Workspace.prototype['_isMyWindow'] = function(actor) { return true; };

    originalFunctions['_updateWindowPositions'] = Workspace.Workspace.prototype['_updateWindowPositions'];
    Workspace.Workspace.prototype['_updateWindowPositions'] = _updateWindowPositions;

    originalFunctions['zoomFromOverview'] = Workspace.Workspace.prototype['zoomFromOverview'];
    Workspace.Workspace.prototype['zoomFromOverview'] = zoomFromOverview;

    originalWorkspacesView = WorkspacesView.WorkspacesView.prototype;
    if (ShellVersion[1] === 10) {
        WorkspacesView.WorkspacesView.prototype = UnifiedWorkspacesView10.UnifiedWorkspacesView.prototype;
    } else if (ShellVersion[1] === 12) {
        WorkspacesView.WorkspacesView.prototype = UnifiedWorkspacesView12.UnifiedWorkspacesView.prototype;
    } else if (ShellVersion[1] === 14) {
        WorkspacesView.WorkspacesView.prototype = UnifiedWorkspacesView14.UnifiedWorkspacesView.prototype;
    }

    if (ShellVersion[1] === 4) {
        Main.overview._workspacesDisplay._updateWorkspacesViews();
    } else if (ShellVersion[1] === 8) {
        Main.overview._viewSelector._workspacesDisplay._updateWorkspacesViews();
    } else if (ShellVersion[1] === 10 || ShellVersion[1] === 12 || ShellVersion[1] === 14) {
        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews();
    }
}

function disable() {
    Workspace.Workspace.prototype['_onCloneSelected'] = originalFunctions['_onCloneSelected'];
    Workspace.Workspace.prototype['_isMyWindow'] = originalFunctions['_isMyWindow'];
    Workspace.Workspace.prototype['_updateWindowPositions'] = originalFunctions['_updateWindowPositions'];
    Workspace.Workspace.prototype['zoomFromOverview'] = originalFunctions['zoomFromOverview'];

    WorkspacesView.WorkspacesView.prototype = originalWorkspacesView;
    if (ShellVersion[1] === 4) {
        Main.overview._workspacesDisplay._updateWorkspacesViews();
    } else if (ShellVersion[1] === 8) {
        Main.overview._viewSelector._workspacesDisplay._updateWorkspacesViews();
    } else if (ShellVersion[1] === 10 || ShellVersion[1] === 12 || ShellVersion[1] === 14) {
        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews();
    }
}
