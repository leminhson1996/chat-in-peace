import clsx from 'clsx'
import { getIcon } from '../icons'

interface Props {
  username: string
  // `iconOverride` lets a caller pin a specific icon (used by the picker preview).
  // When undefined, the avatar reads the icon from chatStore.userIcons.
  iconOverride?: string | null
  size?: number
  className?: string
}

import { useChatStore } from '../store/chatStore'

export default function UserAvatar({ username, iconOverride, size = 28, className }: Props) {
  const storeIcon = useChatStore(s => s.userIcons[username])
  const iconId = iconOverride !== undefined ? iconOverride : storeIcon
  const icon = getIcon(iconId)
  // Icons sit slightly smaller than the circle they live in.
  const iconSize = Math.max(12, Math.round(size * 0.55))
  return (
    <div
      className={clsx(
        'rounded-full bg-discord-accent flex items-center justify-center text-white font-bold shrink-0',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-label={username}
    >
      {icon
        ? <icon.Component size={iconSize} aria-hidden />
        : <span>{username[0]?.toUpperCase() ?? '?'}</span>
      }
    </div>
  )
}
