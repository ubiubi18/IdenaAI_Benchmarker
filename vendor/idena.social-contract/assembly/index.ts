import {
    Address,
    Bytes,
    Context,
    Host, 
    Balance,
    PersistentMap,
    util,
    u128,
    models,
} from 'idena-sdk-as';
import { Protobuf } from 'as-proto';

const createGetIdentityPromiseGasLimit = 20_000;
const defaultGetIdentityGasLimit = 2_000_000;

class MakePostArgs {
    message: string = '';
    channelId: string = '';
    replyToPostId: string = '';
    repostPostId: string = '';
    media: string[] = [];
    mediaType: string[] = [];
    tags: string[] = [];
    _getIdentityGasLimit: u32 = defaultGetIdentityGasLimit;
}

class SendTipArgs {
    postId: string = '0';
    _getIdentityGasLimit: u32 = defaultGetIdentityGasLimit;
}

class SendMessageArgs {
    recipient: string = '';
    message: string = '';
    encrypted: boolean = false;
    channelId: string = '';
    replyToMessageTxId: string = '';
    _getIdentityGasLimit: u32 = defaultGetIdentityGasLimit;
}

export class IdenaSocial {
    currentPostId: u128;
    posts: PersistentMap<u128, string>;

    constructor() {
        this.currentPostId = u128.Zero;
        this.posts = PersistentMap.withStringPrefix<u128, string>('p:');
    }

    @mutateState
    makePost(args: MakePostArgs): void {
        const postId = u128.add(this.currentPostId, u128.fromString('1'));
        this.posts.set(postId, util.toHexString(Context.caller(), true));

        this.currentPostId = postId;

        Host.emitEvent('makePost', [
            Context.caller().toBytes(),
            Bytes.fromu128(postId),
            Bytes.fromString(args.channelId),
            Bytes.fromString(args.message),
            Bytes.fromString(args.replyToPostId),
            Bytes.fromString(args.repostPostId),
            Bytes.fromString(args.media.toString()),
            Bytes.fromString(args.mediaType.toString()),
            Bytes.fromString(args.tags.toString()),
            Bytes.fromBytes(Context.payAmount().toBytes())
        ]);
        Host.createGetIdentityPromise(Context.caller(), createGetIdentityPromiseGasLimit).then('_getIdentity', [Context.caller().toBytes()], Balance.Zero, args._getIdentityGasLimit);
    }

    @mutateState
    sendTip(args: SendTipArgs): void {
        const postId = u128.fromString(args.postId);
        util.assert(postId > u128.Zero && postId <= this.currentPostId, 'non-existent post');

        const tipAmount: Balance = Context.payAmount();
        util.assert(tipAmount > Balance.Zero, 'cannot tip nothing');

        const posterHex: string = this.posts.get(postId, '');
        const poster = Address.fromBytes(util.decodeFromHex(posterHex));

        Host.createTransferPromise(poster, tipAmount);
        Host.emitEvent('sendTip', [Context.caller().toBytes(), poster.toBytes(), Bytes.fromu128(postId), Bytes.fromBytes(tipAmount.toBytes())]);
        Host.createGetIdentityPromise(Context.caller(), createGetIdentityPromiseGasLimit).then('_getIdentity', [Context.caller().toBytes()], Balance.Zero, args._getIdentityGasLimit);
    }

    @mutateState
    sendMessage(args: SendMessageArgs): void {
        Host.emitEvent('sendMessage', [
            Context.caller().toBytes(),
            Bytes.fromString(args.recipient),
            Bytes.fromString(args.channelId),
            Bytes.fromString(args.message),
            Bytes.fromString(args.encrypted.toString()),
            Bytes.fromString(args.replyToMessageTxId),
            Bytes.fromBytes(Context.payAmount().toBytes())
        ]);
        Host.createGetIdentityPromise(Context.caller(), createGetIdentityPromiseGasLimit).then('_getIdentity', [Context.caller().toBytes()], Balance.Zero, args._getIdentityGasLimit);
    }

    @mutateState
    _getIdentity(originalCaller: Address): void {
        const res = Host.promiseResult();
        util.assert(!res.failed(), 'createGetIdentityPromise result should be successful');

        const identity = Protobuf.decode<models.ProtoStateIdentity>(res.data, models.ProtoStateIdentity.decode);
        const age = identity.birthday === 0 ? 0 : Context.epoch() - identity.birthday;

        Host.emitEvent('_getIdentity', [originalCaller.toBytes(), Bytes.fromBytes(identity.stake), Bytes.fromU32(identity.state), Bytes.fromU32(age)]);
    }
}
