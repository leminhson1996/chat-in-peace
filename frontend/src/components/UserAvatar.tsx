import clsx from 'clsx'
import { getIcon } from '../icons'
import { getColor } from '../colors'
import { useChatStore } from '../store/chatStore'

interface Props {
  username: string
  // `iconOverride` / `colorOverride` let a caller pin specific values (used by
  // the admin picker preview). When undefined, the avatar reads them from
  // chatStore.userIcons / chatStore.userColors.
  iconOverride?: string | null
  colorOverride?: string | null
  size?: number
  className?: string
}

export default function UserAvatar({ username, iconOverride, colorOverride, size = 28, className }: Props) {
  const storeIcon = useChatStore(s => s.userIcons[username])
  const storeColor = useChatStore(s => s.userColors[username])
  const iconId = iconOverride !== undefined ? iconOverride : storeIcon
  const colorId = colorOverride !== undefined ? colorOverride : storeColor
  const icon = getIcon(iconId)
  const color = getColor(colorId)
  // Icons sit slightly smaller than the circle they live in.
  const iconSize = Math.max(12, Math.round(size * 0.55))
  return (
    <div
      className={clsx(
        // bg-discord-accent is the fallback when no color is chosen; an
        // inline backgroundColor overrides it when one is.
        'rounded-full bg-discord-accent flex items-center justify-center text-white font-bold shrink-0',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        ...(color ? { backgroundColor: color.hex } : null),
      }}
      aria-label={username}
    >
      {icon
        ? <icon.Component size={iconSize} aria-hidden />
        : <span>{username[0]?.toUpperCase() ?? '?'}</span>
      }
    </div>
  )
}
