import { EdgeCurrencyWallet } from 'edge-core-js'
import { sprintf } from 'sprintf-js'

import { launchPriceChangeBuySellSwapModal } from '../components/modals/PriceChangeBuySellSwapModal'
import { showError, showToast } from '../components/services/AirshipInstance'
import { guiPlugins } from '../constants/plugins/GuiPlugins'
import s from '../locales/strings'
import { DeepLink } from '../types/DeepLinkTypes'
import { Dispatch, RootState, ThunkAction } from '../types/reduxTypes'
import { Actions } from '../types/routerTypes'
import { activatePromotion } from './AccountReferralActions'
import { launchBitPay } from './BitPayActions'
import { loginWithEdge } from './EdgeLoginActions'
import { doRequestAddress, parseScannedUri } from './ScanActions'
import { selectWallet } from './WalletActions'

/**
 * The app has just received some of link,
 * so try to follow it if possible, or save it for later if not.
 */
export function launchDeepLink(link: DeepLink): ThunkAction<void> {
  return (dispatch, getState) => {
    const state = getState()

    const handled = handleLink(dispatch, state, link)

    // If we couldn't handle the link, save it for later:
    if (!handled) {
      dispatch({ type: 'DEEP_LINK_RECEIVED', data: link })
    }
  }
}

/**
 * The deep linking manager calls this as the wallet list changes.
 * Maybe we were in the wrong state before, but now we are able
 * to launch the link.
 */
export function retryPendingDeepLink(): ThunkAction<void> {
  return (dispatch, getState) => {
    const state = getState()
    const { pendingDeepLink } = state
    if (pendingDeepLink == null) return

    const handled = handleLink(dispatch, state, pendingDeepLink)

    // If we handled the link, clear it:
    if (handled) {
      dispatch({ type: 'DEEP_LINK_HANDLED' })
    }
  }
}

/**
 * Launches a link if it app is able to do so.
 */
function handleLink(dispatch: Dispatch, state: RootState, link: DeepLink): boolean {
  const { activeWalletIds, currencyWallets, username } = state.core.account
  const { byId = {}, selectedWalletId } = state.ui.wallets
  const hasCurrentWallet = byId[selectedWalletId] != null

  // Wait for all wallets to load before handling deep links
  if (activeWalletIds.length !== Object.keys(currencyWallets).length) return false

  // We can't handle any links without an account:
  if (username == null) return false

  switch (link.type) {
    case 'edgeLogin':
      dispatch(loginWithEdge(link.lobbyId))
      Actions.push('edgeLogin', {})
      return true

    // The login scene always handles this one:
    case 'passwordRecovery':
      return false

    case 'plugin': {
      const { pluginId, path, query } = link
      const plugin = guiPlugins[pluginId]
      if (pluginId === 'custom' || plugin == null || plugin.pluginId == null) {
        showError(new Error(`No plugin named ${pluginId} exists`))
        return true
      }
      Actions.push('pluginView', {
        plugin,
        deepPath: path,
        deepQuery: query
      })
      return true
    }

    case 'promotion': {
      if (!state.account.accountReferralLoaded) return false
      const { installerId = '' } = link
      dispatch(activatePromotion(installerId))
      return true
    }

    case 'requestAddress': {
      doRequestAddress(state.core.account, dispatch, link)
      return true
    }

    case 'swap': {
      if (!hasCurrentWallet) return false
      Actions.push('exchangeScene', {})
      return true
    }

    case 'azteco': {
      if (!hasCurrentWallet) return false
      const edgeWallet = currencyWallets[selectedWalletId]
      if (edgeWallet.currencyInfo.currencyCode !== 'BTC') {
        Actions.push('walletListScene', {})
        showError(s.strings.azteco_btc_only)
        return false
      }
      launchAzteco(edgeWallet, link.uri).catch(showError)
      return true
    }

    case 'walletConnect': {
      if (!hasCurrentWallet) return false
      const { uri, isSigning } = link
      Actions.push('wcConnections', {})
      // Hack around our router's horrible bugs:
      if (!isSigning) setTimeout(() => Actions.push('wcConnect', { uri }), 100)
      return true
    }

    case 'bitPay': {
      launchBitPay(link.uri, { currencyWallets }).catch(showError)
      return true
    }

    case 'price-change': {
      dispatch(launchPriceChangeBuySellSwapModal(link))
      return true
    }

    case 'other': {
      if (!hasCurrentWallet) return false
      const currencyName = link.protocol
      // @ts-expect-error
      const currencyCode = CURRENCY_NAMES[currencyName]

      // If we don't know what this is, fake a barcode scan:
      if (currencyCode == null) {
        dispatch(parseScannedUri(link.uri))
        return true
      }

      // See if we have a wallet that can handle this currency:
      const walletIds = Object.keys(byId)
      for (const walletId of walletIds) {
        const wallet = byId[walletId]
        if (wallet.currencyCode !== currencyCode) continue
        dispatch(selectWallet(wallet.id, wallet.currencyCode))
        dispatch(parseScannedUri(link.uri))
        return true
      }

      // Keep waiting while wallets are loading:
      if (walletIds.length !== activeWalletIds.length) return false

      // Show an error:
      const currency = convertCurrencyStringFromCurrencyCode(currencyCode)
      const noWalletMessage = sprintf(s.strings.alert_deep_link_no_wallet, currency, currency)
      showError(noWalletMessage)
      return true
    }

    case 'dev': {
      // @ts-expect-error
      if (!global.__DEV__) return false

      Actions.push(link.sceneName, {})
      return true
    }
  }

  return false
}

async function launchAzteco(edgeWallet: EdgeCurrencyWallet, uri: string): Promise<void> {
  const address = await edgeWallet.getReceiveAddress()
  const response = await fetch(`${uri}${address.publicAddress}`)
  if (response.ok) {
    showToast(s.strings.azteco_success)
  } else if (response.status === 400) {
    showError(s.strings.azteco_invalid_code)
  } else {
    showError(s.strings.azteco_service_unavailable)
  }
  Actions.push('walletListScene', {})
}

const CURRENCY_NAMES = {
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  ethereum: 'ETH',
  litecoin: 'LTC',
  dash: 'DASH',
  rsk: 'RBTC'
}

function convertCurrencyStringFromCurrencyCode(code: string): string {
  switch (code) {
    case 'BTC':
      return 'Bitcoin'
    case 'BCH':
      return 'Bitcoin Cash'
    case 'ETH':
      return 'Ethereum'
    case 'LTC':
      return 'Litecoin'
    case 'DASH':
      return 'Dash'
    case 'RBTC':
      return 'RSK'
    default:
      return code
  }
}
