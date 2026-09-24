package nz.co.altitudehd.regattanz;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.os.Bundle;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.splashscreen.SplashScreenViewProvider;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setOnExitAnimationListener(this::fadeOutSplash);
        super.onCreate(savedInstanceState);
    }

    private void fadeOutSplash(SplashScreenViewProvider provider) {
        View view = provider.getView();
        ObjectAnimator fade = ObjectAnimator.ofFloat(view, View.ALPHA, 1f, 0f);
        fade.setInterpolator(new DecelerateInterpolator());
        fade.setDuration(320L);

        AnimatorSet set = new AnimatorSet();
        set.play(fade);
        set.addListener(
            new android.animation.AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(android.animation.Animator animation) {
                    provider.remove();
                }
            }
        );
        set.start();
    }
}
