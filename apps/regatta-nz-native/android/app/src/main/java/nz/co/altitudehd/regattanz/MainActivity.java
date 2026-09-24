package nz.co.altitudehd.regattanz;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Solid teal splash (no icon plate). Remove immediately so the web
        // cold-start intro is the only branded phase the user sees.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setOnExitAnimationListener(provider -> provider.remove());
        super.onCreate(savedInstanceState);
    }
}
