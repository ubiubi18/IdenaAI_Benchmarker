import { MAX_POST_MEDIA_BYTES_RPC, supportedImageTypes, type Post, type Tip, type RpcPostCostEstimate } from './logic/asyncUtils';
import { useLocation, useOutletContext } from 'react-router';
import PostComponent from './components/PostComponent';
import { type BrowserStateHistorySettings, type MouseEventLocal } from './App.exports';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { DesktopBootstrap } from './logic/desktopBootstrap';
import SortPostsByComponent from './components/SortPostsByComponent';

type LatestPostsProps = {
    currentBlockCaptured: number,
    nodeAvailable: boolean,
    latestPosts: string[],
    latestActivity: string[],
    postsRef: React.RefObject<Record<string, Post>>,
    replyPostsTreeRef: React.RefObject<Record<string, string>>,
    deOrphanedReplyPostsTreeRef: React.RefObject<Record<string, string>>,
    discussPrefix: string,
    scanningPastBlocks: boolean,
    setScanningPastBlocks: React.Dispatch<React.SetStateAction<boolean>>,
    noMorePastBlocks: boolean,
    pastBlockCaptured: number,
    SET_NEW_POSTS_ADDED_DELAY: number,
    inputPostDisabled: boolean,
    copyPostTxHandler: (location: string, replyToPostId?: string | undefined, channelId?: string | undefined) => Promise<void>,
    submitPostHandler: (location: string, replyToPostId?: string | undefined, channelId?: string | undefined) => Promise<void>,
    submitLikeHandler: (emoji: string, location: string, replyToPostId?: string | undefined, channelId?: string | undefined) => Promise<void>,
    submittingPost: string,
    submittingLike: string,
    submittingTip: string,
    browserStateHistoryRef: React.RefObject<Record<string, BrowserStateHistorySettings>>,
    setBrowserStateHistorySettings: (pageDomSetting: Partial<BrowserStateHistorySettings>, rerender?: boolean) => void,
    handleOpenLikesModal: (e: MouseEventLocal, likePosts: Post[]) => void,
    handleOpenTipsModal: (e: MouseEventLocal, likePosts: Tip[]) => void,
    handleOpenSendTipModal: (e: MouseEventLocal, tipToPost: Post) => void,
    tipsRef: React.RefObject<Record<string, { totalAmount: number, tips: Tip[] }>>,
    setPostMediaAttachmentHandler: (location: string, file?: File | undefined) => Promise<void>,
    postMediaAttachmentsRef: React.RefObject<any>,
    estimatePostCostHandler: (inputText: string, mediaFile?: File | undefined) => Promise<RpcPostCostEstimate | null>,
    mainComposerCostEstimate: RpcPostCostEstimate | null,
    setMainComposerCostEstimate: React.Dispatch<React.SetStateAction<RpcPostCostEstimate | null>>,
    mainComposerCostEstimateError: string,
    setMainComposerCostEstimateError: React.Dispatch<React.SetStateAction<string>>,
    mainComposerCostEstimateLoading: boolean,
    setMainComposerCostEstimateLoading: React.Dispatch<React.SetStateAction<boolean>>,
    inputSendingTxs: string,
    embeddedDesktopOnchainMode?: boolean,
    desktopBootstrap?: DesktopBootstrap,
};

function HoverInfo({ label, widthClass = 'w-72' }: { label: string, widthClass?: string }) {
    const [open, setOpen] = useState(false);

    return (
        <span
            className="relative ml-1 inline-flex align-middle"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-stone-500 text-[10px] font-[700] text-stone-300 hover:cursor-help">i</span>
            <span
                className={`pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 text-left text-[11px] leading-4 text-stone-200 shadow-2xl ${widthClass}`}
                style={{ display: open ? 'block' : 'none' }}
            >
                {label}
            </span>
        </span>
    );
}

function LatestPosts() {
    const location = useLocation();

    const { key: locationKey } = location;

    const {
        currentBlockCaptured,
        nodeAvailable,
        latestPosts,
        latestActivity,
        postsRef,
        replyPostsTreeRef,
        deOrphanedReplyPostsTreeRef,
        discussPrefix,
        scanningPastBlocks,
        setScanningPastBlocks,
        noMorePastBlocks,
        pastBlockCaptured,
        SET_NEW_POSTS_ADDED_DELAY,
        inputPostDisabled,
        copyPostTxHandler,
        submitPostHandler,
        submitLikeHandler,
        submittingPost,
        submittingLike,
        submittingTip,
        browserStateHistoryRef,
        setBrowserStateHistorySettings,
        handleOpenLikesModal,
        handleOpenTipsModal,
        handleOpenSendTipModal,
        tipsRef,
        setPostMediaAttachmentHandler,
        postMediaAttachmentsRef,
        estimatePostCostHandler,
        mainComposerCostEstimate,
        setMainComposerCostEstimate,
        mainComposerCostEstimateError,
        setMainComposerCostEstimateError,
        mainComposerCostEstimateLoading,
        setMainComposerCostEstimateLoading,
        inputSendingTxs,
        embeddedDesktopOnchainMode,
        desktopBootstrap,
    } = useOutletContext() as LatestPostsProps;

    const [, forceUpdate] = useReducer(x => x + 1, 0);
    const [mainDraftText, setMainDraftText] = useState('');
    const lastAppliedPrefillRef = useRef('');
    const proposalMode = desktopBootstrap?.proposalMode === true;
    const proposalPublishingEnabled = proposalMode
        ? desktopBootstrap?.proposalPublishingEnabled !== false
        : true;
    const proposalTag = desktopBootstrap?.proposalTag || '#IdenaDAO';
    const normalizedProposalTag = proposalTag.trim().toLowerCase();
    const proposalComposerPlaceholder = desktopBootstrap?.composerPlaceholder
        || 'Draft your governance proposal here.';
    const proposalComposerHint = desktopBootstrap?.composerHint
        || `Only posts containing ${proposalTag} are surfaced in this governance view.`;
    const proposalPrefillText = desktopBootstrap?.composerPrefillText || '';
    const mainComposerDisabled = inputPostDisabled || (proposalMode && !proposalPublishingEnabled);

    if (!browserStateHistoryRef.current[locationKey]?.sortPostsBy) {
        setBrowserStateHistorySettings({ sortPostsBy: 'latest-posts' });
    }

    const sortPostsBy = browserStateHistoryRef.current[locationKey].sortPostsBy;
    const sortedPostIds = sortPostsBy === 'latest-posts' ? latestPosts : latestActivity;
    const mainPostMediaAttachment = postMediaAttachmentsRef.current['main'];
    const mainFeeTooltipText = mainComposerCostEstimate
        ? `Current conservative max-fee cap from your own node RPC: about ${mainComposerCostEstimate.totalMaxFeeDna} iDNA. Breakdown: contract call ${mainComposerCostEstimate.contractCallMaxFeeDna} iDNA${mainComposerCostEstimate.imageStoredToIpfs ? `, image storage ${mainComposerCostEstimate.imageStoreMaxFeeDna} iDNA` : ''}${mainComposerCostEstimate.textStoredToIpfs ? `, long-text storage ${mainComposerCostEstimate.textStoreMaxFeeDna} iDNA` : ''}. The actual charged fee can be lower.`
        : 'Start typing or attach an image to request a conservative max-fee estimate from your own node RPC.';
    const visiblePostIds = proposalMode
        ? sortedPostIds.filter((postId) => {
            const post = postsRef.current[postId];
            return !post?.replyToPostId && !!post?.message?.toLowerCase().includes(normalizedProposalTag);
        })
        : sortedPostIds;

    useEffect(() => {
        if (!proposalMode) {
            lastAppliedPrefillRef.current = '';
            return;
        }

        if (lastAppliedPrefillRef.current === proposalPrefillText) {
            return;
        }

        const previousPrefill = lastAppliedPrefillRef.current;
        lastAppliedPrefillRef.current = proposalPrefillText;

        setMainDraftText((currentValue) => {
            if (!currentValue.trim() || currentValue === previousPrefill) {
                return proposalPrefillText;
            }

            return currentValue;
        });
    }, [proposalMode, proposalPrefillText]);

    useEffect(() => {
        if (submittingPost === 'main') {
            setMainDraftText('');
            setMainComposerCostEstimate(null);
            setMainComposerCostEstimateError('');
        }
    }, [
        setMainComposerCostEstimate,
        setMainComposerCostEstimateError,
        submittingPost,
    ]);

    useEffect(() => {
        let canceled = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        const runEstimate = async () => {
            setMainComposerCostEstimateError('');

            if (inputSendingTxs !== 'rpc' || mainComposerDisabled) {
                setMainComposerCostEstimate(null);
                setMainComposerCostEstimateLoading(false);
                return;
            }

            if (!mainDraftText && !mainPostMediaAttachment?.file) {
                setMainComposerCostEstimate(null);
                setMainComposerCostEstimateLoading(false);
                return;
            }

            setMainComposerCostEstimateLoading(true);

            try {
                const estimate = await estimatePostCostHandler(mainDraftText, mainPostMediaAttachment?.file);
                if (!canceled) {
                    setMainComposerCostEstimate(estimate);
                }
            } catch {
                if (!canceled) {
                    setMainComposerCostEstimate(null);
                    setMainComposerCostEstimateError('Fee estimate unavailable right now.');
                }
            } finally {
                if (!canceled) {
                    setMainComposerCostEstimateLoading(false);
                }
            }
        };

        timeoutId = setTimeout(runEstimate, 350);

        return () => {
            canceled = true;
            clearTimeout(timeoutId);
        };
    }, [
        estimatePostCostHandler,
        inputSendingTxs,
        mainComposerDisabled,
        mainDraftText,
        mainPostMediaAttachment?.file,
        setMainComposerCostEstimate,
        setMainComposerCostEstimateError,
        setMainComposerCostEstimateLoading,
    ]);

    const addMediaHandler = async (e: React.ChangeEvent<HTMLInputElement>, location: string) => {
        e?.stopPropagation();

        await setPostMediaAttachmentHandler(location, e.currentTarget.files?.[0]);
        forceUpdate();
    };

    const removeMediaHandler = (e: MouseEventLocal, location: string) => {
        e?.stopPropagation();

        postMediaAttachmentsRef.current = { ...postMediaAttachmentsRef.current, [location]: undefined };
        forceUpdate();
    };

    return (<>
        <div
            className={embeddedDesktopOnchainMode ? 'mx-auto w-full max-w-[1360px]' : 'w-full'}
            style={embeddedDesktopOnchainMode ? { width: '100%', maxWidth: '1360px' } : undefined}
        >
            {proposalMode && (
                <div className="mb-3 rounded-md border border-blue-400/30 bg-blue-500/10 px-4 py-3 text-[13px] text-stone-100">
                    <p className="font-[700]">IdenaDAO proposal mode</p>
                    <p className="mt-1 text-stone-300">{proposalComposerHint}</p>
                    {!proposalPublishingEnabled && (
                        <p className="mt-2 text-amber-300">
                            Validation is required before this governance composer can publish a new proposal.
                        </p>
                    )}
                </div>
            )}
            <textarea
                id='post-input-main'
                rows={6}
                className="w-full field-sizing-content min-h-[160px] max-h-[520px] py-2 px-3 mt-5 text-[15px] leading-6 outline-1 placeholder:text-gray-500 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-track]:bg-neutral-700 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500 [&::-webkit-scrollbar-corner]:bg-neutral-500"
                placeholder={proposalMode ? proposalComposerPlaceholder : 'Write your post here...'}
                disabled={mainComposerDisabled}
                value={mainDraftText}
                onChange={(event) => setMainDraftText(event.target.value)}
            />
            {mainPostMediaAttachment && <div className="mx-4 my-1">
                <img className="max-h-[640px] w-auto max-w-full rounded-sm" src={mainPostMediaAttachment.dataUrl} />
            </div>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-stone-300">
                <p>
                    <strong>Image limit:</strong> {(MAX_POST_MEDIA_BYTES_RPC / (1024 * 1024)).toFixed(0)} MB
                    <HoverInfo label="Supported formats: PNG, JPEG, GIF, WebP, AVIF, APNG, SVG. The current embedded RPC limit is 1 MB. In desktop RPC mode the file is stored through your own node IPFS path first and then referenced on-chain by CID." />
                </p>
                <p>
                    <strong>Posting model:</strong> RPC + on-chain reference
                    <HoverInfo label="An image post adds one dna_storeToIpfs transaction for the file plus one contract_call for the message. Text over 100 characters adds another IPFS storage transaction." />
                </p>
                <p>
                    <strong>Current max-fee:</strong>{' '}
                    {mainComposerCostEstimateLoading
                        ? 'estimating…'
                        : mainComposerCostEstimate
                            ? `about ${mainComposerCostEstimate.totalMaxFeeDna} iDNA`
                            : mainComposerCostEstimateError || 'start typing or attach an image'}
                    <HoverInfo label={mainFeeTooltipText} widthClass="w-80" />
                </p>
                {mainComposerCostEstimateError && !mainComposerCostEstimateLoading && (
                    <p className="text-red-400">{mainComposerCostEstimateError}</p>
                )}
            </div>
            <div className="flex flex-row gap-2">
                <div className="flex-1 -mt-1.5">
                    {mainPostMediaAttachment ? <>
                        <p className="inline-block -mt-1 text-blue-400 text-[12px] hover:cursor-pointer hover:underline" onClick={(e) => !mainComposerDisabled && removeMediaHandler(e, 'main')}>Remove image</p>
                    </> : <>
                        <label htmlFor="post-input-media-main" className={`inline-block -mt-1 text-[12px] ${mainComposerDisabled ? 'text-stone-500' : 'text-blue-400 hover:cursor-pointer hover:underline'}`} onClick={(e) => e.stopPropagation()}>Add image</label>
                        <input
                            id="post-input-media-main"
                            type="file"
                            accept={supportedImageTypes.join(',')}
                            className="hidden"
                            disabled={mainComposerDisabled}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => addMediaHandler(e, 'main')}
                        />
                    </>}
                    {proposalMode && proposalPrefillText && (
                        <p
                            className={`inline-block -mt-1 ml-2 text-[12px] ${mainComposerDisabled ? 'text-stone-500' : 'text-blue-400 hover:cursor-pointer hover:underline'}`}
                            onClick={() => !mainComposerDisabled && setMainDraftText(proposalPrefillText)}
                        >
                            Restore template
                        </p>
                    )}
                    <p id="post-copytx-main" className={`inline-block -mt-1 ml-2 text-[12px] ${mainComposerDisabled ? 'text-stone-500' : 'text-blue-400 hover:cursor-pointer hover:underline'}`} onClick={() => !mainComposerDisabled && copyPostTxHandler('main')}>Copy tx</p>
                </div>
                <p className="text-right w-50 mt-0.5 text-gray-400 text-[12px]">Your post will take time to display due to blockchain acceptance.</p>
                <button className="h-9 w-27 my-1 px-4 py-1 bg-white/10 inset-ring inset-ring-white/5 hover:bg-white/20 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" disabled={mainComposerDisabled} onClick={() => submitPostHandler('main')}>{submittingPost === 'main' ? 'Posting...' : 'Post!'}</button>
            </div>
        </div>
        {proposalMode && visiblePostIds.length === 0 && (
            <div className="my-4 rounded-md border border-stone-700 bg-stone-900/80 px-4 py-3 text-[13px] text-stone-300">
                No tagged IdenaDAO proposals are visible yet. Publish a post that includes {proposalTag} to seed this governance feed.
            </div>
        )}
        <div className="text-center my-3">
            <p>Current Block: #{currentBlockCaptured ? currentBlockCaptured : (nodeAvailable ? 'Loading...' : '')}</p>
            {!nodeAvailable && <p className="text-[11px] text-red-400">Blocks are not being captured. Please update your node.</p>}
        </div>
        <SortPostsByComponent sortPostsBy={sortPostsBy} setBrowserStateHistorySettings={setBrowserStateHistorySettings} />
        <ul className="w-full">
            {visiblePostIds.map((postId) => (
                <li key={postId} className="w-full">
                    <PostComponent
                        postId={postId}
                        postsRef={postsRef}
                        replyPostsTreeRef={replyPostsTreeRef}
                        deOrphanedReplyPostsTreeRef={deOrphanedReplyPostsTreeRef}
                        discussPrefix={discussPrefix}
                        SET_NEW_POSTS_ADDED_DELAY={SET_NEW_POSTS_ADDED_DELAY}
                        inputPostDisabled={inputPostDisabled}
                        copyPostTxHandler={copyPostTxHandler}
                        submitPostHandler={submitPostHandler}
                        submitLikeHandler={submitLikeHandler}
                        submittingPost={submittingPost}
                        submittingLike={submittingLike}
                        submittingTip={submittingTip}
                        browserStateHistoryRef={browserStateHistoryRef}
                        setBrowserStateHistorySettings={setBrowserStateHistorySettings}
                        handleOpenLikesModal={handleOpenLikesModal}
                        handleOpenTipsModal={handleOpenTipsModal}
                        handleOpenSendTipModal={handleOpenSendTipModal}
                        tipsRef={tipsRef}
                        setPostMediaAttachmentHandler={setPostMediaAttachmentHandler}
                        postMediaAttachmentsRef={postMediaAttachmentsRef}
                    />
                </li>
            ))}
        </ul>
        <div className="flex flex-col gap-2 mb-15">
            <button className={`h-9 mt-1 px-4 py-1 bg-white/10 inset-ring inset-ring-white/5 ${scanningPastBlocks || noMorePastBlocks ? '' : 'hover:bg-white/20 cursor-pointer'}`} disabled={scanningPastBlocks || noMorePastBlocks || !nodeAvailable} onClick={() => setScanningPastBlocks(true)}>
                {scanningPastBlocks ? "Scanning blockchain...." : (noMorePastBlocks ? "No more past posts" : "Scan for more posts")}
            </button>
            <p className="pr-12 text-gray-400 text-[12px] text-center">
                {!scanningPastBlocks ? <>Posts found down to Block # <span className="absolute">{pastBlockCaptured || 'unavailable'}</span></> : <>&nbsp;</>}
            </p>
        </div>
    </>);
}

export default LatestPosts;
