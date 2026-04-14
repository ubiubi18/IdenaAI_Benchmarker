import {useQuery} from 'react-query'
import {useCoinbase} from '../../ads/hooks'
import {loadValidationState} from '../utils'

export function usePersistedValidationState(options) {
  const coinbase = useCoinbase()

  return useQuery({
    queryKey: ['validationState', coinbase],
    queryFn: () => loadValidationState(),
    ...options,
  })
}
