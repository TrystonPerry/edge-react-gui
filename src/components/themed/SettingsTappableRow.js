// @flow

import * as React from 'react'
import AntDesignIcon from 'react-native-vector-icons/AntDesign'
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5'

import { type ThemeProps, withTheme } from '../services/ThemeContext.js'
import { SettingsRow } from './SettingsRow.js'

type OwnProps = {
  // The icon to show on the right.
  // Defaults to navigate, which shows an arrow.
  action?: 'navigate' | 'add' | 'delete' | 'lock' | 'unlock',

  disabled?: boolean, // Show with grey style
  icon?: React.Node,
  text: string | React.Node,

  // Called when the user presses the row.
  // If the callback returns a promise, the row will disable itself
  // and show a spinner until the promise resolves.
  onPress?: () => void | Promise<void>
}

type Props = OwnProps & ThemeProps

/**
 * A settings row with an icon on the right side.
 * The default icon is a navigation arrow, but other options are available.
 */
function SettingsTappableRowComponent(props: Props): React.Node {
  const { action = 'navigate', disabled, icon, text, theme, onPress } = props

  const style = {
    color: disabled ? theme.iconDeactivated : theme.iconTappable,
    fontSize: theme.rem(1)
  }

  const rightIcon =
    action === 'navigate' ? (
      <FontAwesome5 name="chevron-right" style={style} />
    ) : action === 'add' ? (
      <AntDesignIcon name="plus" style={style} />
    ) : action === 'delete' ? (
      <AntDesignIcon name="close" style={style} />
    ) : (
      <AntDesignIcon name={action} style={style} />
    )
  return <SettingsRow disabled={disabled} icon={icon} text={text} right={rightIcon} onPress={onPress} />
}

export const SettingsTappableRow: React.StatelessFunctionalComponent<$Exact<OwnProps>> = withTheme(SettingsTappableRowComponent)