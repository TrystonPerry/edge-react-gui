import { EdgeAccount } from 'edge-core-js'
import { LoginScreen } from 'edge-login-ui-rn'
import { NotificationPermissionsInfo } from 'edge-login-ui-rn/lib/types/ReduxTypes'
import * as React from 'react'
import { Keyboard, StatusBar, View } from 'react-native'
import { checkVersion } from 'react-native-check-version'
import { BlurView } from 'rn-id-blurview'

import { showSendLogsModal } from '../../actions/LogActions'
import { initializeAccount, logoutRequest } from '../../actions/LoginActions'
import { updateNotificationSettings } from '../../actions/NotificationActions'
import { cacheStyles, Theme, useTheme } from '../../components/services/ThemeContext'
import { ENV } from '../../env'
import { ExperimentConfig, getExperimentConfig } from '../../experimentConfig'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useAsyncValue } from '../../hooks/useAsyncValue'
import { useHandler } from '../../hooks/useHandler'
import { useWatch } from '../../hooks/useWatch'
import { lstrings } from '../../locales/strings'
import { config } from '../../theme/appConfig'
import { useDispatch, useSelector } from '../../types/reactRedux'
import { EdgeSceneProps } from '../../types/routerTypes'
import { ImageProp } from '../../types/Theme'
import { GuiTouchIdInfo } from '../../types/types'
import { logEvent, trackError } from '../../util/tracking'
import { pickRandom } from '../../util/utils'
import { withServices } from '../hoc/withServices'
import { showHelpModal } from '../modals/HelpModal'
import { UpdateModal } from '../modals/UpdateModal'
import { Airship, showError } from '../services/AirshipInstance'
import { getBackgroundImage } from './../../util/ThemeCache'
import { LoadingScene } from './LoadingScene'

// Sneak the BlurView over to the login UI:
// @ts-expect-error
global.ReactNativeBlurView = BlurView

interface Props extends EdgeSceneProps<'login'> {}

let firstRun = true

export function LoginSceneComponent(props: Props) {
  const { navigation, route } = props
  const { loginUiInitialRoute = 'login' } = route.params ?? {}
  const dispatch = useDispatch()
  const theme = useTheme()
  const styles = getStyles(theme)

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const account = useSelector(state => state.core.account)
  const context = useSelector(state => state.core.context)
  const disklet = useSelector(state => state.core.disklet)
  const pendingDeepLink = useSelector(state => state.pendingDeepLink)
  const nextLoginId = useSelector(state => state.nextLoginId)
  const loggedIn = useWatch(account, 'loggedIn')

  const [counter, setCounter] = React.useState<number>(0)
  const [notificationPermissionsInfo, setNotificationPermissionsInfo] = React.useState<NotificationPermissionsInfo | undefined>()
  const [passwordRecoveryKey, setPasswordRecoveryKey] = React.useState<string | undefined>()
  const [experimentConfig, setExperimentConfig] = React.useState<ExperimentConfig>()

  const fontDescription = React.useMemo(
    () => ({
      headingFontFamily: theme.fontFaceMedium,
      regularFontFamily: theme.fontFaceDefault
    }),
    [theme]
  )

  // ---------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------

  const [backgroundImage = theme.backgroundImage] = useAsyncValue<ImageProp | undefined>(async () => {
    const url = pickRandom(theme.backgroundImageServerUrls)
    return await getBackgroundImage(disklet, url, theme.backgroundImage)
  }, [disklet, theme])

  React.useEffect(() => {
    const { YOLO_USERNAME, YOLO_PASSWORD, YOLO_PIN } = ENV
    if (YOLO_USERNAME != null && (Boolean(YOLO_PASSWORD) || Boolean(YOLO_PIN)) && firstRun) {
      firstRun = false
      if (YOLO_PIN != null) {
        context
          .loginWithPIN(YOLO_USERNAME, YOLO_PIN)
          .then(async account => {
            await dispatch(initializeAccount(navigation, account, dummyTouchIdInfo))
          })
          .catch(showError)
      }
      if (YOLO_PASSWORD != null) {
        context
          .loginWithPassword(YOLO_USERNAME, YOLO_PASSWORD)
          .then(async account => {
            await dispatch(initializeAccount(navigation, account, dummyTouchIdInfo))
          })
          .catch(showError)
      }
    }
  }, [context, dispatch, navigation])

  React.useEffect(() => {
    if (pendingDeepLink != null && pendingDeepLink.type === 'passwordRecovery') {
      // Log out if necessary:
      if (account.loggedIn) {
        dispatch(logoutRequest(navigation)).catch(err => showError(err))
      }

      // Pass the link to our component:
      const { passwordRecoveryKey } = pendingDeepLink
      setPasswordRecoveryKey(passwordRecoveryKey)
      setCounter(counter => counter + 1)
      dispatch({ type: 'DEEP_LINK_HANDLED' })
    }
  }, [account, dispatch, navigation, pendingDeepLink])

  const checkForUpdates = useHandler(async () => {
    const response = await checkVersion()
    const skipUpdate = (await disklet.getText('ignoreUpdate.json').catch(() => '')) === response.version
    if (response.needsUpdate && !skipUpdate) {
      await Airship.show(bridge => (
        <UpdateModal
          bridge={bridge}
          onSkip={() => {
            disklet
              .setText('ignoreUpdate.json', response.version)
              .then(() => bridge.resolve())
              .catch(err => bridge.reject(err))
          }}
        />
      ))
    }
  })
  React.useEffect(() => {
    checkForUpdates().catch(error => showError(error))
  }, [checkForUpdates])

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------

  const parentButton = React.useMemo(
    () => ({
      callback() {
        Keyboard.dismiss()
        showHelpModal(navigation).catch(err => showError(err))
      },
      text: lstrings.string_help
    }),
    [navigation]
  )

  const maybeHandleComplete =
    ENV.USE_WELCOME_SCREENS && experimentConfig != null && experimentConfig.legacyLanding === 'uspLanding'
      ? () => {
          navigation.navigate('gettingStarted', {})
        }
      : undefined

  const handleLogin = useHandler(async (account: EdgeAccount, touchIdInfo: GuiTouchIdInfo | undefined) => {
    setPasswordRecoveryKey(undefined)
    await dispatch(initializeAccount(navigation, account, touchIdInfo ?? dummyTouchIdInfo))

    if (notificationPermissionsInfo) {
      try {
        await dispatch(updateNotificationSettings(notificationPermissionsInfo.notificationOptIns))
      } catch (e) {
        trackError(e, 'LoginScene:onLogin:setDeviceSettings')
        console.error(e)
      }
    }
  })

  const handleSendLogs = useHandler(() => {
    dispatch(showSendLogsModal()).catch(err => showError(err))
  })

  // Wait for the experiment config to initialize before rendering anything
  useAsyncEffect(async () => {
    const experimentConfig = await getExperimentConfig()
    setExperimentConfig(experimentConfig)
  }, [])

  return loggedIn || experimentConfig == null ? (
    <LoadingScene />
  ) : (
    <View style={styles.container} testID="edge: login-scene">
      <LoginScreen
        key={String(counter)}
        accountOptions={accountOptions}
        appConfig={config}
        appId={config.appId}
        appName={config.appNameShort}
        backgroundImage={backgroundImage}
        context={context}
        fontDescription={fontDescription}
        initialLoginId={nextLoginId ?? undefined}
        initialRoute={loginUiInitialRoute}
        parentButton={parentButton}
        primaryLogo={theme.primaryLogo}
        primaryLogoCallback={handleSendLogs}
        recoveryLogin={passwordRecoveryKey}
        skipSecurityAlerts
        experimentConfig={experimentConfig}
        onComplete={maybeHandleComplete}
        onLogEvent={logEvent}
        onLogin={handleLogin}
        onNotificationPermit={setNotificationPermissionsInfo}
      />
    </View>
  )
}

const accountOptions = {
  pauseWallets: true
}

const dummyTouchIdInfo: GuiTouchIdInfo = {
  isTouchEnabled: true,
  isTouchSupported: true
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    flex: 1,
    paddingTop: StatusBar.currentHeight,
    backgroundColor: theme.backgroundGradientColors[0]
  }
}))

export const LoginScene = withServices(LoginSceneComponent)
