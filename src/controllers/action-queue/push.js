// @flow

import { asMaybe } from 'cleaners'
import { type EdgeAccount } from 'edge-core-js'
import { getUniqueId } from 'react-native-device-info'

import ENV from '../../../env'
import s from '../../locales/strings'
import { asBase64 } from '../../util/cleaners/asBase64'
import { asHex } from '../../util/cleaners/asHex'
import { exhaustiveCheck } from '../../util/exhaustiveCheck'
import { type ActionEffect, type ActionProgram, type ExecutionOutput } from './types'
import { type LoginUpdatePayload, type PushRequestBody, asErrorResponse, asLoginPayload, wasLoginUpdatePayload, wasPushRequestBody } from './types/pushApiTypes'
import { type BroadcastTx, type NewPushEvent, type PushMessage, type PushTrigger } from './types/pushTypes'

const { ACTION_QUEUE, AIRBITZ_API_KEY } = ENV
const { pushServerUri } = ACTION_QUEUE
const deviceId = getUniqueId()

/*
Each PushEvent's trigger should be the effect of the previous ExecutionOutput:

  [ A, B, C ]
  -> [ 
    {trigger: initEffect, ...convertToPushEvent(A)},
    {trigger: A.effect, ...convertToPushEvent(B)}, 
    {trigger: B.effect, ...convertToPushEvent(C)}, 
  ]

The initEffect is the current effect in the program's state. This should 
always be defined because the first action in the program should be run even
for new programs.

Although the last effect is not used here, but the caller may use it to
determine the final effect in the chain.
*/
export async function prepareNewPushEvents(
  account: EdgeAccount,
  program: ActionProgram,
  initEffect: ActionEffect,
  dryrunOutputs: ExecutionOutput[]
): Promise<NewPushEvent[]> {
  const { programId } = program

  // Final push message to send to the device once server has finished all events
  const pushMessage: PushMessage = {
    title: s.strings.action_queue_push_notification_title,
    body: s.strings.action_queue_push_notification_body
  }

  const pushEvents: NewPushEvent[] = await Promise.all(
    dryrunOutputs.map(async (output, index) => {
      const prevEffect = index > 0 ? dryrunOutputs[index - 1].effect : initEffect

      const callStackId = getCallStackId(output.effect)
      const eventId = `${programId}:${callStackId}`
      const broadcastTxs: BroadcastTx[] = await Promise.all(
        output.broadcastTxs.map(async executionTx => {
          const wallet = await account.waitForCurrencyWallet(executionTx.walletId)
          const { pluginId } = wallet.currencyConfig.currencyInfo
          const rawTx = asHex(executionTx.tx.signedTx)

          const broadcastTx: BroadcastTx = { pluginId, rawTx }

          return broadcastTx
        })
      )
      const trigger = await actionEffectToPushTrigger(account, prevEffect)

      // Assert that the given prevEffect is a convertible to a PushTrigger
      if (trigger == null) {
        throw new Error(`Unsupported effect type ${prevEffect.type} in conversion to PushTrigger`)
      }

      const pushEvent: NewPushEvent = {
        eventId,
        broadcastTxs,
        // Include pushMessage only for the last event because device should only wake up when the server finishes all push events.
        pushMessage: index === dryrunOutputs.length - 1 ? pushMessage : undefined,
        recurring: false,
        trigger
      }

      return pushEvent
    })
  )

  return pushEvents
}

export async function checkPushEvents(account: EdgeAccount, eventIds: string[]): Promise<boolean> {
  const { rootLoginId: loginId } = account
  const requestBody: PushRequestBody = {
    apiKey: AIRBITZ_API_KEY,
    deviceId,
    loginId: asBase64(loginId)
  }

  const response = await fetch(`${pushServerUri}/v2/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: wasPushRequestBody(requestBody)
  })

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  const data = await response.json()
  const loginPayload = asLoginPayload(data)
  const eventStatusMap = loginPayload.events.reduce((map, eventStatus) => ({ ...map, [eventStatus.eventId]: eventStatus }), {})

  const isEffective = eventIds.every(eventId => {
    const status = eventStatusMap[eventId]
    return status != null && ['triggered', 'complete'].includes(status.state)
  })

  return isEffective
}

export async function effectCanBeATrigger(account: EdgeAccount, effect: ActionEffect): Promise<boolean> {
  return (await actionEffectToPushTrigger(account, effect)) != null
}

export async function uploadPushEvents(account: EdgeAccount, newPushEvents: NewPushEvent[]): Promise<void> {
  const { rootLoginId: loginId } = account
  const loginUpdatePayload: LoginUpdatePayload = {
    createEvents: newPushEvents,
    removeEvents: []
  }
  const requestBody: PushRequestBody = {
    apiKey: AIRBITZ_API_KEY,
    deviceId,
    loginId: asBase64(loginId)
  }
  const response = await fetch(`${pushServerUri}/v2/login/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: wasPushRequestBody({ ...requestBody, data: wasLoginUpdatePayload(loginUpdatePayload) })
  })

  if (!response.ok) {
    const responseBody = await response.text()
    const responseData = asMaybe(asErrorResponse)(responseBody)
    console.error(
      'Failed push-server request:',
      JSON.stringify(
        {
          responseBody,
          responseData
        },
        null,
        2
      )
    )
    throw new Error(`Request failed with ${response.status}`)
  }
}

async function actionEffectToPushTrigger(account: EdgeAccount, effect: ActionEffect): Promise<PushTrigger | void> {
  const UNEXPECTED_NULL_EFFECT_ERROR_MESSAGE =
    `Unexpected null effect while converting to PushTrigger. ` + `This could be caused by a partial dryrun not properly short-circuiting.`

  switch (effect.type) {
    case 'seq': {
      if (effect.childEffect === null) throw new Error(UNEXPECTED_NULL_EFFECT_ERROR_MESSAGE)
      return actionEffectToPushTrigger(account, effect.childEffect)
    }
    case 'address-balance': {
      const { address, walletId, tokenId, aboveAmount, belowAmount } = effect
      const wallet = await account.waitForCurrencyWallet(walletId)
      const { pluginId } = wallet.currencyInfo
      return {
        type: 'address-balance',
        pluginId,
        tokenId,
        address,
        aboveAmount,
        belowAmount
      }
    }
    case 'price-level': {
      const { currencyPair, aboveRate, belowRate } = effect
      return {
        type: 'price-level',
        currencyPair,
        aboveRate,
        belowRate
      }
    }
    case 'tx-confs': {
      const { confirmations, walletId, txId } = effect
      const wallet = await account.waitForCurrencyWallet(walletId)
      const { pluginId } = wallet.currencyInfo

      return {
        type: 'tx-confirm',
        pluginId,
        confirmations,
        txid: txId
      }
    }

    case 'done': {
      return
    }
    case 'noop': {
      return
    }
    case 'par': {
      return
    }
    case 'push-events': {
      // Would this cause infinite recursion? We may never want to add conversion support for this.
      return
    }
    case 'unixtime': {
      return
    }

    default: {
      // $ExpectError
      throw exhaustiveCheck(effect.type)
    }
  }
}

function getCallStackId(effect: ActionEffect): string {
  const UNEXPECTED_NULL_EFFECT_ERROR_MESSAGE =
    `Unexpected null effect while converting to CallStackId. ` + `This could be caused by a partial dryrun not properly short-circuiting.`

  switch (effect.type) {
    case 'seq': {
      const { opIndex } = effect
      return `seq_${opIndex}`
    }
    case 'par': {
      const childCallStackIds = effect.childEffects
        .map(childEffect => {
          if (childEffect === null) throw new Error(UNEXPECTED_NULL_EFFECT_ERROR_MESSAGE)
          return getCallStackId(childEffect)
        })
        .join('_')
      return `par_${childCallStackIds}`
    }
    default:
      return effect.type
  }
}