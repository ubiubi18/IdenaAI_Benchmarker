export type DesktopBootstrap = {
    embeddedMode?: string;
    nodeUrl?: string;
    nodeApiKey?: string;
    indexerApiUrl?: string;
    sendingTxs?: string;
    findingPastPosts?: string;
};

declare global {
    interface Window {
        __IDENA_SOCIAL_DESKTOP_BOOTSTRAP__?: DesktopBootstrap;
    }
}

export const DESKTOP_BOOTSTRAP_MESSAGE = 'IDENA_SOCIAL_BOOTSTRAP';
export const DESKTOP_BOOTSTRAP_READY_MESSAGE = 'IDENA_SOCIAL_READY';

export const readDesktopBootstrap = (): DesktopBootstrap => {
    if (typeof window === 'undefined') {
        return {};
    }

    const bootstrap = window.__IDENA_SOCIAL_DESKTOP_BOOTSTRAP__;

    return bootstrap && typeof bootstrap === 'object' ? bootstrap : {};
};

export const isEmbeddedDesktopFrame = () =>
    typeof window !== 'undefined' && window.parent && window.parent !== window;

export const installDesktopBootstrapListener = (
    onBootstrap: (bootstrap: DesktopBootstrap) => void,
) => {
    if (typeof window === 'undefined') {
        return () => {};
    }

    const applyBootstrap = (bootstrap: DesktopBootstrap) => {
        const nextBootstrap =
            bootstrap && typeof bootstrap === 'object' ? bootstrap : {};

        window.__IDENA_SOCIAL_DESKTOP_BOOTSTRAP__ = nextBootstrap;
        onBootstrap(nextBootstrap);
    };

    const handleMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) {
            return;
        }

        const payload =
            event && event.data && typeof event.data === 'object'
                ? event.data
                : null;

        if (!payload || payload.type !== DESKTOP_BOOTSTRAP_MESSAGE) {
            return;
        }

        applyBootstrap(payload.payload);
    };

    window.addEventListener('message', handleMessage);

    if (window.parent && window.parent !== window) {
        window.parent.postMessage({type: DESKTOP_BOOTSTRAP_READY_MESSAGE}, '*');
    }

    const existingBootstrap = readDesktopBootstrap();
    if (Object.keys(existingBootstrap).length > 0) {
        onBootstrap(existingBootstrap);
    }

    return () => {
        window.removeEventListener('message', handleMessage);
    };
};
