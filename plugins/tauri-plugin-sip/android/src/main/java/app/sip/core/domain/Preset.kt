package app.sip.core.domain

/**
 * What the next drink repeats: the newest log, or the first volume and first active type when there is none.
 * Derived on every read, so editing, adding or deleting a log moves it.
 */
data class Preset(val typeId: Long?, val volumeId: Long?, val ml: Int?) {
    companion object {
        /** `newest` is the latest log of any day, ties broken by the highest id. */
        fun derive(newest: DrinkLog?, types: List<DrinkType>, volumes: List<Volume>): Preset {
            val active = types.filter { !it.archived }.sortedBy { it.position }
            val ordered = volumes.sortedBy { it.position }
            val type = active.firstOrNull { it.id == newest?.typeId } ?: active.firstOrNull()
            val volume = ordered.firstOrNull { it.ml == newest?.ml } ?: ordered.firstOrNull()
            return Preset(type?.id, volume?.id, newest?.ml ?: volume?.ml)
        }
    }
}
