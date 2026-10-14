package app.everplain.android

import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/** Feature polling follows both navigation and actual Activity foreground state. */
@Composable
internal fun FeatureVisibility(identity: Any, onEnter: () -> Unit, onLeave: () -> Unit) {
    val owner = LocalLifecycleOwner.current
    val enter by rememberUpdatedState(onEnter)
    val leave by rememberUpdatedState(onLeave)
    DisposableEffect(owner, identity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) enter()
            if (event == Lifecycle.Event.ON_STOP) leave()
        }
        owner.lifecycle.addObserver(observer)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) enter()
        onDispose {
            owner.lifecycle.removeObserver(observer)
            leave()
        }
    }
}
