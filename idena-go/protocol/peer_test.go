package protocol

import (
	"testing"
	"time"

	"github.com/idena-network/idena-go/blockchain/types"
	"github.com/idena-network/idena-go/common"
	"github.com/idena-network/idena-go/log"
	"github.com/patrickmn/go-cache"
)

func TestProtoPeerMakeBatchesUsesFlipKeyQueueForBatchFlipKey(t *testing.T) {
	peer := &protoPeer{
		queuedRequests: make(chan *request, 10),
		pushQueue:      make(chan *queueItem, 10),
		flipKeyQueue:   make(chan *queueItem, 10),
		term:           make(chan struct{}),
		finished:       make(chan struct{}),
	}

	go peer.makeBatches()
	defer close(peer.term)

	key1 := &types.PublicFlipKey{Key: bytesOf(1), Epoch: 1}
	key2 := &types.PublicFlipKey{Key: bytesOf(2), Epoch: 1}

	peer.flipKeyQueue <- &queueItem{payload: key1, shardId: 1}
	peer.pushQueue <- &queueItem{payload: pushPullHash{Type: pushTx, Hash: common.Hash128{9}}, shardId: 1}
	peer.flipKeyQueue <- &queueItem{payload: key2, shardId: 1}

	timeout := time.After(2 * time.Second)
	for {
		select {
		case req := <-peer.queuedRequests:
			if req.msgcode != BatchFlipKey {
				continue
			}

			batch, ok := req.data.(*msgBatch)
			if !ok {
				t.Fatalf("expected msgBatch payload, got %T", req.data)
			}
			if len(batch.Data) != 2 {
				t.Fatalf("expected 2 batched flip keys, got %d", len(batch.Data))
			}

			got1 := new(types.PublicFlipKey)
			if err := got1.FromBytes(batch.Data[0].Payload); err != nil {
				t.Fatalf("failed to decode first flip key: %v", err)
			}
			got2 := new(types.PublicFlipKey)
			if err := got2.FromBytes(batch.Data[1].Payload); err != nil {
				t.Fatalf("failed to decode second flip key: %v", err)
			}

			if string(got1.Key) != string(key1.Key) {
				t.Fatalf("unexpected first flip key payload: %x", got1.Key)
			}
			if string(got2.Key) != string(key2.Key) {
				t.Fatalf("unexpected second flip key payload: %x", got2.Key)
			}
			return
		case <-timeout:
			t.Fatal("timed out waiting for batched flip keys")
		}
	}
}

func TestBroadcastFlipKeysPackageSendsDirectPackageMessage(t *testing.T) {
	peer := &protoPeer{
		queuedRequests:       make(chan *request, 10),
		highPriorityRequests: make(chan *request, 10),
		pushQueue:            make(chan *queueItem, 10),
		flipKeyQueue:         make(chan *queueItem, 10),
		finished:             make(chan struct{}),
		msgCache:             cache.New(time.Minute, time.Minute),
		knownHeight:          &syncHeight{},
		potentialHeight:      &syncHeight{},
		log:                  log.New(),
		throttlingLogger:     log.NewThrottlingLogger(log.New()),
		supportedFeatures:    map[PeerFeature]struct{}{},
		shardId:              1,
	}

	peers := newPeerSet()
	peers.SetOwnShardId(1)
	if err := peers.Register(peer); err != nil {
		t.Fatalf("register peer: %v", err)
	}

	handler := &IdenaGossipHandler{peers: peers}
	pkg := &types.PrivateFlipKeysPackage{Data: bytesOf(3), Epoch: 1}

	handler.broadcastFlipKeysPackage(pkg, 1, false)

	timeout := time.After(2 * time.Second)
	var sawPackage, sawPush bool
	for !(sawPackage && sawPush) {
		select {
		case req := <-peer.queuedRequests:
			switch req.msgcode {
			case FlipKeysPackage:
				got := new(types.PrivateFlipKeysPackage)
				if err := got.FromBytes(mustBytes(t, req.data)); err != nil {
					t.Fatalf("failed to decode flip keys package: %v", err)
				}
				if string(got.Data) != string(pkg.Data) || got.Epoch != pkg.Epoch {
					t.Fatalf("unexpected package payload: %+v", got)
				}
				sawPackage = true
			case Push:
				hash, ok := req.data.(pushPullHash)
				if !ok {
					t.Fatalf("expected pushPullHash payload, got %T", req.data)
				}
				if hash.Type != pushKeyPackage || hash.Hash != pkg.Hash128() {
					t.Fatalf("unexpected push payload: %+v", hash)
				}
				sawPush = true
			}
		case <-timeout:
			t.Fatalf("timed out waiting for direct package and push; sawPackage=%v sawPush=%v", sawPackage, sawPush)
		}
	}
}

func bytesOf(b byte) []byte {
	buf := make([]byte, 32)
	for i := range buf {
		buf[i] = b
	}
	return buf
}

func mustBytes(t *testing.T, payload interface{}) []byte {
	t.Helper()

	switch v := payload.(type) {
	case *types.PrivateFlipKeysPackage:
		b, err := v.ToBytes()
		if err != nil {
			t.Fatalf("encode private flip keys package: %v", err)
		}
		return b
	default:
		t.Fatalf("unexpected payload type: %T", payload)
		return nil
	}
}
