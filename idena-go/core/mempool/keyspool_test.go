package mempool

import (
	"crypto/ecdsa"
	"github.com/idena-network/idena-go/blockchain/types"
	"github.com/idena-network/idena-go/common/eventbus"
	"github.com/idena-network/idena-go/core/appstate"
	"github.com/idena-network/idena-go/core/state"
	"github.com/idena-network/idena-go/crypto"
	"github.com/idena-network/idena-go/crypto/ecies"
	"github.com/idena-network/idena-go/events"
	"github.com/idena-network/idena-go/secstore"
	"github.com/stretchr/testify/require"
	dbm "github.com/tendermint/tm-db"
	"testing"
)

func Test_getPrivateKeysPackage(t *testing.T) {
	key1, _ := crypto.GenerateKey()
	key2, _ := crypto.GenerateKey()
	publicEncKey := ecies.ImportECDSA(key1)
	privateEncKey := ecies.ImportECDSA(key2)

	var pk []*ecdsa.PrivateKey
	var pubkeys [][]byte
	for i := 0; i < 10; i++ {
		k, _ := crypto.GenerateKey()
		pk = append(pk, k)
		pubkeys = append(pubkeys, crypto.FromECDSAPub(&k.PublicKey))
	}

	dataToAssert := crypto.FromECDSA(privateEncKey.ExportECDSA())

	for i := 0; i < 10; i++ {
		encryptedData := EncryptPrivateKeysPackage(publicEncKey, privateEncKey, pubkeys)

		encryptedKey, err := getEncryptedKeyFromPackage(publicEncKey, encryptedData, i)
		require.NoError(t, err)

		result, err := ecies.ImportECDSA(pk[i]).Decrypt(encryptedKey, nil, nil)
		require.NoError(t, err)

		require.Equal(t, dataToAssert, result)
	}
}

func TestKeysPoolRetriesPendingFlipKeysOnceSenderFlipsAppear(t *testing.T) {
	db := dbm.NewMemDB()
	bus := eventbus.New()
	appState, err := appstate.NewAppState(db, bus)
	require.NoError(t, err)
	require.NoError(t, appState.Initialize(0))

	senderKey, err := crypto.GenerateKey()
	require.NoError(t, err)
	senderStore := secstore.NewSecStore()
	senderStore.AddKey(crypto.FromECDSA(senderKey))
	t.Cleanup(senderStore.Destroy)

	receiverKey, err := crypto.GenerateKey()
	require.NoError(t, err)
	receiverStore := secstore.NewSecStore()
	receiverStore.AddKey(crypto.FromECDSA(receiverKey))
	t.Cleanup(receiverStore.Destroy)

	sender := senderStore.GetAddress()
	const epoch = uint16(1)

	commitState := func(height uint64, mutate func()) {
		mutate()
		require.NoError(t, appState.Commit(nil))
		require.NoError(t, appState.Initialize(height))
	}

	commitState(1, func() {
		appState.State.SetGlobalEpoch(epoch)
		appState.State.SetState(sender, state.Verified)
	})

	pool := NewKeysPool(db, appState, bus, receiverStore)
	pool.Initialize(&types.Header{
		EmptyBlockHeader: &types.EmptyBlockHeader{Height: 1},
	})

	flipKey, err := crypto.GenerateKey()
	require.NoError(t, err)

	signedFlipKey, err := senderStore.SignFlipKey(&types.PublicFlipKey{
		Key:   crypto.FromECDSA(flipKey),
		Epoch: epoch,
	})
	require.NoError(t, err)

	signedKeysPackage, err := senderStore.SignFlipKeysPackage(&types.PrivateFlipKeysPackage{
		Data:  []byte{1, 2, 3},
		Epoch: epoch,
	})
	require.NoError(t, err)

	require.Equal(t, KeySkipped, pool.AddPublicFlipKey(signedFlipKey, false))
	require.Equal(t, KeySkipped, pool.AddPrivateKeysPackage(signedKeysPackage, false))
	require.Contains(t, pool.pendingFlipKeys, sender)
	require.Contains(t, pool.pendingFlipKeyPackages, sender)
	require.NotContains(t, pool.flipKeys, sender)
	require.NotContains(t, pool.flipKeyPackages, sender)

	commitState(2, func() {
		appState.State.AddFlip(sender, []byte("cid-1"), 0)
	})

	bus.Publish(&events.NewBlockEvent{
		Block: &types.Block{
			Header: &types.Header{
				EmptyBlockHeader: &types.EmptyBlockHeader{Height: 2},
			},
		},
	})

	require.NotContains(t, pool.pendingFlipKeys, sender)
	require.NotContains(t, pool.pendingFlipKeyPackages, sender)
	require.Contains(t, pool.flipKeys, sender)
	require.Contains(t, pool.flipKeyPackages, sender)
	require.NotNil(t, pool.GetPublicFlipKey(sender))
}

func TestKeysPoolAsyncBatchRetriesPendingFlipKeysOnceSenderFlipsAppear(t *testing.T) {
	db := dbm.NewMemDB()
	bus := eventbus.New()
	appState, err := appstate.NewAppState(db, bus)
	require.NoError(t, err)
	require.NoError(t, appState.Initialize(0))

	senderKey, err := crypto.GenerateKey()
	require.NoError(t, err)
	senderStore := secstore.NewSecStore()
	senderStore.AddKey(crypto.FromECDSA(senderKey))
	t.Cleanup(senderStore.Destroy)

	receiverKey, err := crypto.GenerateKey()
	require.NoError(t, err)
	receiverStore := secstore.NewSecStore()
	receiverStore.AddKey(crypto.FromECDSA(receiverKey))
	t.Cleanup(receiverStore.Destroy)

	sender := senderStore.GetAddress()
	const epoch = uint16(1)

	commitState := func(height uint64, mutate func()) {
		mutate()
		require.NoError(t, appState.Commit(nil))
		require.NoError(t, appState.Initialize(height))
	}

	commitState(1, func() {
		appState.State.SetGlobalEpoch(epoch)
		appState.State.SetState(sender, state.Verified)
	})

	pool := NewKeysPool(db, appState, bus, receiverStore)
	pool.Initialize(&types.Header{
		EmptyBlockHeader: &types.EmptyBlockHeader{Height: 1},
	})

	flipKey, err := crypto.GenerateKey()
	require.NoError(t, err)

	signedFlipKey, err := senderStore.SignFlipKey(&types.PublicFlipKey{
		Key:   crypto.FromECDSA(flipKey),
		Epoch: epoch,
	})
	require.NoError(t, err)

	signedKeysPackage, err := senderStore.SignFlipKeysPackage(&types.PrivateFlipKeysPackage{
		Data:  []byte{4, 5, 6},
		Epoch: epoch,
	})
	require.NoError(t, err)

	pool.AddPublicFlipKeys([]*types.PublicFlipKey{signedFlipKey})
	pool.AddPrivateFlipKeysPackages([]*types.PrivateFlipKeysPackage{signedKeysPackage})
	require.Contains(t, pool.pendingFlipKeys, sender)
	require.Contains(t, pool.pendingFlipKeyPackages, sender)
	require.NotContains(t, pool.flipKeys, sender)
	require.NotContains(t, pool.flipKeyPackages, sender)

	commitState(2, func() {
		appState.State.AddFlip(sender, []byte("cid-2"), 1)
	})

	bus.Publish(&events.NewBlockEvent{
		Block: &types.Block{
			Header: &types.Header{
				EmptyBlockHeader: &types.EmptyBlockHeader{Height: 2},
			},
		},
	})

	require.NotContains(t, pool.pendingFlipKeys, sender)
	require.NotContains(t, pool.pendingFlipKeyPackages, sender)
	require.Contains(t, pool.flipKeys, sender)
	require.Contains(t, pool.flipKeyPackages, sender)
}
