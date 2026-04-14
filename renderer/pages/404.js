import React from 'react'
import {useTranslation} from 'react-i18next'
import {Box, Flex, Heading, Stack, Text} from '@chakra-ui/react'
import {FillCenter} from '../screens/oracles/components'
import Layout from '../shared/components/layout'
import {PrimaryButton} from '../shared/components/button'
import {Page} from '../shared/components/components'

export default function Custom404() {
  const {t} = useTranslation()

  return (
    <Layout>
      <Page p={0}>
        <Flex
          bg="graphite.500"
          color="white"
          direction="column"
          flex={1}
          w="full"
        >
          <Box bg="orange.500" p={3} textAlign="center">
            {t('Page not found')}
          </Box>
          <FillCenter>
            <Stack align="center" spacing={4}>
              <Heading fontSize="lg" fontWeight={500}>
                {t('The page you are looking for does not exist')}
              </Heading>
              <Text color="xwhite.050">
                {t('Go back to My Idena to continue')}
              </Text>
              <Box>
                <PrimaryButton
                  onClick={() => global.ipcRenderer.send('reload')}
                >
                  {t('Go to My Idena')}
                </PrimaryButton>
              </Box>
            </Stack>
          </FillCenter>
        </Flex>
      </Page>
    </Layout>
  )
}
