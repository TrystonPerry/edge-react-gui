import { OtpError } from 'edge-core-js'
import * as React from 'react'

import { TextInputModal } from '../components/modals/TextInputModal'
import { Airship, showError } from '../components/services/AirshipInstance'
import s from '../locales/strings'
import { Dispatch, GetState } from '../types/reduxTypes'
import { Actions } from '../types/routerTypes'

export const handleOtpError = (otpError: OtpError) => (dispatch: Dispatch, getState: GetState) => {
  const state = getState()
  const { account, otpErrorShown } = state.core

  if (account.loggedIn && !otpErrorShown) {
    dispatch({ type: 'OTP_ERROR_SHOWN' })
    Actions.push('otpRepair', {
      otpError
    })
  }
}

type ValidatePasswordOptions = {
  message?: string
  submitLabel?: string
  title?: string
  warningMessage?: string
}

export const validatePassword =
  (opts: ValidatePasswordOptions = {}) =>
  async (dispatch: Dispatch, getState: GetState): Promise<boolean> => {
    const { message, submitLabel, title = s.strings.confirm_password_text, warningMessage } = opts
    const state = getState()
    const { account } = state.core
    const password = await Airship.show<string | undefined>(bridge => (
      <TextInputModal
        autoFocus={warningMessage == null}
        autoCorrect={false}
        bridge={bridge}
        inputLabel={s.strings.enter_your_password}
        message={message}
        returnKeyType="go"
        secureTextEntry
        submitLabel={submitLabel}
        title={title}
        warningMessage={warningMessage}
        onSubmit={async password => {
          const isOk = await account.checkPassword(password)
          if (!isOk) return s.strings.password_reminder_invalid
          dispatch({ type: 'PASSWORD_USED' })
          return true
        }}
      />
    ))

    return password != null
  }

export const deleteLocalAccount = (username: string) => async (dispatch: Dispatch, getState: GetState) => {
  const state = getState()
  return state.core.context.deleteLocalAccount(username).catch(showError)
}