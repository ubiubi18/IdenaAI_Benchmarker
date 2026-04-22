import {useQuery} from 'react-query'
import {useCoinbase} from '../../ads/hooks'
import {loadValidationStateByIdentityScope} from '../utils'

export function usePersistedValidationState({
  scope = null,
  live = false,
  ...options
} = {}) {
  const coinbase = useCoinbase()

  return useQuery({
    queryKey: [
      'validationState',
      coinbase,
      scope?.address || '',
      scope?.nodeScope || '',
    ],
    queryFn: () => loadValidationStateByIdentityScope(scope),
    refetchInterval: live ? 1000 : false,
    refetchIntervalInBackground: live,
    refetchOnMount: live ? 'always' : true,
    refetchOnWindowFocus: live,
    ...options,
  })
}
