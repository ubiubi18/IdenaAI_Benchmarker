package blockchain

import (
	"math/big"
	"testing"

	"github.com/idena-network/idena-go/blockchain/attachments"
	"github.com/idena-network/idena-go/blockchain/fee"
	"github.com/idena-network/idena-go/blockchain/types"
	"github.com/idena-network/idena-go/blockchain/validation"
	"github.com/idena-network/idena-go/common"
	"github.com/idena-network/idena-go/config"
	"github.com/idena-network/idena-go/core/state"
	"github.com/idena-network/idena-go/crypto"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func TestBuildTxWithFeeEstimatingUsesEffectiveFeeFloor(t *testing.T) {
	alloc := map[common.Address]config.GenesisAllocation{}
	for i := 0; i < 8; i++ {
		key, err := crypto.GenerateKey()
		require.NoError(t, err)
		addr := crypto.PubkeyToAddress(key.PublicKey)
		alloc[addr] = config.GenesisAllocation{State: uint8(state.Verified)}
	}

	chain, appState, _, key := NewTestBlockchain(true, alloc)
	defer chain.SecStore().Destroy()

	sender := crypto.PubkeyToAddress(key.PublicKey)
	appState.State.SetBalance(sender, new(big.Int).Mul(big.NewInt(100), common.DnaBase))
	appState.State.SetFeePerGas(big.NewInt(1))
	appState.ValidatorsCache.Load()

	tx := BuildTxWithFeeEstimating(
		appState,
		sender,
		nil,
		types.OnlineStatusTx,
		decimal.Zero,
		decimal.Zero,
		decimal.Zero,
		0,
		0,
		attachments.CreateOnlineStatusAttachment(true),
	)

	minFeePerGas := fee.GetFeePerGasForNetwork(appState.ValidatorsCache.NetworkSize())
	minFee := fee.CalculateFee(appState.ValidatorsCache.NetworkSize(), minFeePerGas, tx)
	require.GreaterOrEqual(t, tx.MaxFeeOrZero().Cmp(minFee), 0)

	signedTx, err := chain.secStore.SignTx(tx)
	require.NoError(t, err)
	require.NoError(t, validation.ValidateTx(appState, signedTx, minFeePerGas, validation.InboundTx))
}
