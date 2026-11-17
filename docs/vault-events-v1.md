# Vault internal offset event v1

Decodes `0x1::dex::VaultInternalOffsetEvent` from both BCS hex and JSON; the
field order matches the chain's golden vector.

- `schema_version` is fixed at 1 and `status` is 0-3; an unknown version or
  status is rejected rather than decoded.
- u64 and u128 keep full precision. A PnL field suffixed `_bits` is an i128
  two's-complement bit pattern and must be read as signed.
- Only `status=0` means both legs reduced quantums; a failed event must not
  reduce inventory.
- An internal offset closes a position inside one account. It is not an external
  market fill and not a TWAP fill.
- Order and deduplicate by the originating transaction version and `event_index`,
  never by arrival time.

Pre-liquidation account snapshots and end-of-block monitoring snapshots are out
of scope here. The standalone golden vector is `vault_internal_offset_v1.json`.
