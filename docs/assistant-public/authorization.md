# Authorization

The platform uses explicit roles and capabilities. Unknown roles or capabilities fail closed. Active users may use ordinary application features, while administrative reads and writes require additional capabilities.

## User Role

Users with the `USER` role can use authenticated application features. They cannot list accounts, read audit summaries, or manage other users.

## Support Role

Users with the `SUPPORT` role can list accounts and read safe audit summaries. They cannot change another user's role or status.

## Manager Role

Users with the `MANAGER` role can list accounts, read safe audit summaries, and manage basic users. Managers may change users between `USER` and `SUPPORT` and may update those users' status. They cannot manage privileged managers or administrators.

## Administrator Role

Users with the `ADMIN` role can manage basic and privileged users. Administrative safeguards prevent self-targeted updates and protect the last active administrator from removal.

## Disabled Accounts

Disabled accounts cannot establish or continue authenticated sessions. Role checks never substitute for the active-account requirement.
