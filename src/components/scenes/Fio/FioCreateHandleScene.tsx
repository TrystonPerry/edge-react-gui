import { asNumber, asObject, asString, asValue } from 'cleaners'
import { EdgeCurrencyWallet } from 'edge-core-js'
import * as React from 'react'
import { NativeSyntheticEvent, ScrollView, TextInput, TextInputSelectionChangeEventData, View } from 'react-native'
import FastImage from 'react-native-fast-image'
import { cacheStyles } from 'react-native-patina'
import { sprintf } from 'sprintf-js'

import { createFioWallet, refreshAllFioAddresses } from '../../../actions/FioAddressActions'
import { FIO_ADDRESS_DELIMITER } from '../../../constants/WalletAndCurrencyConstants'
import { useAsyncEffect } from '../../../hooks/useAsyncEffect'
import { useHandler } from '../../../hooks/useHandler'
import s from '../../../locales/strings'
import { useDispatch, useSelector } from '../../../types/reactRedux'
import { NavigationProp, RouteProp } from '../../../types/routerTypes'
import { getFioCustomizeHandleImage } from '../../../util/CdnUris'
import { SceneWrapper } from '../../common/SceneWrapper'
import { showError } from '../../services/AirshipInstance'
import { Theme, useTheme } from '../../services/ThemeContext'
import { EdgeText } from '../../themed/EdgeText'
import { MainButton } from '../../themed/MainButton'
import { OutlinedTextInput } from '../../themed/OutlinedTextInput'

interface Props {
  navigation: NavigationProp<'fioCreateHandle'>
  route: RouteProp<'fioCreateHandle'>
}

export interface FioCreateHandleProps {
  freeRegApiToken: string
  freeRegRefCode: string
}

const asRegisterSuccessRes = asObject({
  account_id: asNumber,
  error: asValue(false)
})

const asRegisterFailedRes = asObject({
  success: asValue(false),
  error: asString
})

const asFreeFioDomain = asObject({
  domain: asString,
  free: asValue(true)
})

export const FioCreateHandleScene = ({ navigation, route }: Props) => {
  const { freeRegApiToken, freeRegRefCode } = route.params

  const theme = useTheme()
  const styles = getStyles(theme)
  const dispatch = useDispatch()
  const account = useSelector(state => state.core.account)
  const accountUserName = useSelector(state => state.core.account.username)
  const fioPlugin = useSelector(state => state.core.account.currencyConfig.fio)
  if (fioPlugin.otherMethods == null) {
    showError(s.strings.fio_register_handle_error)
    navigation.pop()
  }

  const [wallet, setWallet] = React.useState<EdgeCurrencyWallet | undefined>()
  const [domainStr, setDomainStr] = React.useState<string>('')
  const [fioHandle, setFioHandle] = React.useState<string>('')
  const [errorText, setErrorText] = React.useState<string>()

  const inputRef = React.useRef<TextInput>(null)
  const mounted = React.useRef<boolean>(true)

  const handleChangeFioHandle = useHandler((userInput: string) => {
    // Clean the userInput:
    userInput = userInput.replace(domainStr, '').trim()

    // Dash '-' allowed, but cannot be first or last character
    userInput = userInput.charAt(0).replace('-', '') + userInput.slice(1, -1) + userInput.slice(-1).replace('-', '')

    // ASCII a-z 0-9. Remove all non-alphanumeric characters, convert to
    // lowercase. Allow dashes as they were cleaned above
    userInput = userInput.replace(/[^a-z0-9-]/gi, '').toLowerCase()

    setFioHandle(userInput)
  })

  const handleRegisterPress = async () => {
    // Register button is disabled if wallet ctreation isn't finished yet.
    // Shouldn't happen.
    if (wallet == null) return
    await account.waitForCurrencyWallet(wallet.id)

    // Check if the handle is already registered
    const fioAccountName = `${fioHandle}${domainStr}`
    if (!(await fioPlugin.otherMethods.validateAccount(fioAccountName))) {
      if (!mounted.current) return
      setErrorText(sprintf(s.strings.fio_register_handle_taken_error_s, fioAccountName))
    }

    // Register handle
    try {
      // TODO: Refactor fioPlugin.otherMethods.buyAddressRequest to support
      // handling custom referralCode and apiToken
      const regAddressRes = await fetch('https://reg.fioprotocol.io/public-api/buy-address', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: fioAccountName,
          referralCode: freeRegRefCode,
          publicKey: (await wallet.getReceiveAddress()).publicAddress,
          redirectUrl: '',
          apiToken: freeRegApiToken
        })
      }).then(async res => await res.json())

      // Check registration status
      try {
        asRegisterSuccessRes(regAddressRes)

        dispatch(refreshAllFioAddresses())
        navigation.pop()
      } catch (e: any) {
        // Rejected somehow, see if error is readable
        const failedRes = asRegisterFailedRes(regAddressRes)
        if (!mounted.current) return
        setErrorText(failedRes.error)
      }
    } catch (e: any) {
      // Registration fetch failed
      console.error(JSON.stringify(e, null, 2))
      if (!mounted.current) return
      setErrorText(s.strings.fio_register_handle_error)
    }
  }

  // Ensure that focus puts the cursor after the handle, but before the domain
  const handleInputFocus = useHandler(() => {
    setErrorText(undefined)
    if (inputRef.current != null) {
      inputRef.current.focus()
      inputRef.current.setNativeProps({ selection: { start: fioHandle.length, end: fioHandle.length } })
    }
  })

  const handleInputClear = useHandler(() => {
    if (!mounted.current) return
    // TODO: BUG: Clearing the field twice consecutively will clear the domain.
    setFioHandle('')
  })

  // Ensure the cursor cannot be moved beyond the handle portion of the input
  const handleSelectionChange = useHandler((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    const start = event.nativeEvent.selection.start
    // Check if the cursor is within the handle name and before the domain
    if (start > fioHandle.length) {
      // Move the cursor back to the end of the handle name
      inputRef.current && inputRef.current.setNativeProps({ selection: { start: fioHandle.length, end: fioHandle.length } })
    }
  })

  const handleCancelPress = useHandler(() => {
    navigation.goBack()
  })

  // Create the new FIO wallet, default the handle to a cleaned version of the username
  useAsyncEffect(async () => {
    const wallet = await dispatch(createFioWallet())

    if (!mounted.current) return
    setWallet(wallet)

    handleChangeFioHandle(accountUserName)

    const domains = await fioPlugin.otherMethods.getDomains(freeRegRefCode)
    if (domains.length === 1) {
      if (!mounted.current) return
      try {
        setDomainStr(`${FIO_ADDRESS_DELIMITER}${asFreeFioDomain(domains[0]).domain}`)
      } catch (e) {
        setErrorText(s.strings.fio_register_handle_error)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    // Clear error, if there was one
    setErrorText(undefined)
  }, [fioHandle])

  React.useEffect(() => {
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SceneWrapper background="theme">
      <ScrollView contentContainerStyle={styles.container}>
        <FastImage source={{ uri: getFioCustomizeHandleImage(theme) }} style={styles.icon} />
        <EdgeText style={styles.title}>{s.strings.personalize_wallet_title}</EdgeText>
        <View style={styles.inputContainer}>
          <OutlinedTextInput
            ref={inputRef}
            value={`${fioHandle} ${domainStr}`}
            onChangeText={handleChangeFioHandle}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={handleInputFocus}
            onClear={handleInputClear}
            onSelectionChange={handleSelectionChange}
            // Actual limit is 64 total, but we added an extra space between domain and handle for prettiness
            maxLength={65}
            showSpinner={domainStr === ''}
          />
          <EdgeText style={styles.errorText} numberOfLines={5}>
            {errorText ?? ''}
          </EdgeText>
        </View>
        <View style={styles.buttonContainer}>
          <MainButton
            type="primary"
            label={s.strings.fio_register_handle_button}
            onPress={handleRegisterPress}
            marginRem={0.5}
            disabled={fioHandle.length < 3 || errorText != null || wallet == null}
          />
          <MainButton type="escape" label={s.strings.string_cancel_cap} onPress={handleCancelPress} marginRem={0.5} />
        </View>
      </ScrollView>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  buttonContainer: {
    width: '100%',
    flex: 1,
    flexGrow: 1,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    marginBottom: theme.rem(2),
    paddingHorizontal: theme.rem(1)
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.rem(1)
  },
  errorText: {
    fontSize: theme.rem(0.75),
    color: theme.dangerText
  },
  icon: {
    width: theme.rem(10),
    height: theme.rem(10),
    marginTop: theme.rem(1),
    marginBottom: theme.rem(0.5)
  },
  title: {
    fontSize: theme.rem(1.75),
    marginBottom: theme.rem(1),
    textAlign: 'center'
  },
  inputContainer: {
    width: '75%',
    marginTop: theme.rem(1)
  }
}))