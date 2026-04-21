package flip

import (
	"testing"

	"github.com/idena-network/idena-go/blockchain/validation"
	"github.com/idena-network/idena-go/common/eventbus"
	"github.com/idena-network/idena-go/config"
	"github.com/idena-network/idena-go/core/appstate"
	"github.com/idena-network/idena-go/crypto"
	"github.com/idena-network/idena-go/secstore"
	"github.com/stretchr/testify/require"
	dbm "github.com/tendermint/tm-db"
)

func TestFlipperUsesSharedFlipKeysWhenEnabled(t *testing.T) {
	db := dbm.NewMemDB()
	bus := eventbus.New()
	appState, err := appstate.NewAppState(db, bus)
	require.NoError(t, err)
	require.NoError(t, appState.Initialize(0))
	appState.State.SetGlobalEpoch(1)

	validation.SetAppConfig(&config.Config{
		Validation: &config.ValidationConfig{UseSharedFlipKeys: true},
	})
	t.Cleanup(func() {
		validation.SetAppConfig(&config.Config{
			Validation: &config.ValidationConfig{},
		})
	})

	storeA := secstore.NewSecStore()
	storeB := secstore.NewSecStore()
	t.Cleanup(storeA.Destroy)
	t.Cleanup(storeB.Destroy)

	keyA, err := crypto.GenerateKey()
	require.NoError(t, err)
	keyB, err := crypto.GenerateKey()
	require.NoError(t, err)
	storeA.AddKey(crypto.FromECDSA(keyA))
	storeB.AddKey(crypto.FromECDSA(keyB))

	flipperA := NewFlipper(db, nil, nil, nil, storeA, appState, bus)
	flipperB := NewFlipper(db, nil, nil, nil, storeB, appState, bus)

	require.Equal(
		t,
		crypto.FromECDSA(flipperA.GetFlipPublicEncryptionKey().ExportECDSA()),
		crypto.FromECDSA(flipperB.GetFlipPublicEncryptionKey().ExportECDSA()),
	)
	require.Equal(
		t,
		crypto.FromECDSA(flipperA.GetFlipPrivateEncryptionKey().ExportECDSA()),
		crypto.FromECDSA(flipperB.GetFlipPrivateEncryptionKey().ExportECDSA()),
	)
}
