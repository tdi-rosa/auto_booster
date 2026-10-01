package com.tdirosa.wikimasterauto

import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        val webView = findViewById<WebView>(R.id.loginWebView)
        val doneButton = findViewById<Button>(R.id.doneButton)

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.loadUrl("${WikiMastersClient.BASE_URL}/login")

        doneButton.setOnClickListener {
            CookieManager.getInstance().flush()
            finish()
        }
    }
}
