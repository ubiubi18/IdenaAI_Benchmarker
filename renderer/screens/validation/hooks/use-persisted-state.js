import {useQuery} from 'react-query'
import {useCoinbase} from '../../ads/hooks'
import {loadValidationStateByIdentityScope} from '../utils'

export function usePersistedValidationState({scope = null, ...options} = {}) {
  const coinbase = useCoinbase()

  return useQuery({
    queryKey: [
      'validationState',
      coinbase,
      scope?.address || '',
      scope?.nodeScope || '',
    ],
    queryFn: () => loadValidationStateByIdentityScope(scope),
    ...options,
  })
}
