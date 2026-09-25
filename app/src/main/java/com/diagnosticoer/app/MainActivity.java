package com.diagnosticoer.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String REMOTE_INDEX_URL = "https://raw.githubusercontent.com/Cuto1/diagnostico-er-app/main/docs/index.html";
    private static final String UPDATE_FILE_NAME = "diagnostico_er_updated_index.html";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.addJavascriptInterface(new AndroidUpdaterBridge(), "AndroidUpdater");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {

                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = filePathCallback;

                try {
                    Intent intent = fileChooserParams.createIntent();
                    intent.setType("image/*");
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        loadBestContent();
    }

    private File updateFile() {
        return new File(getFilesDir(), UPDATE_FILE_NAME);
    }

    private void loadBestContent() {
        try {
            File cached = updateFile();
            if (cached.exists()) {
                String html = readAll(new FileInputStream(cached));
                if (isValidAppHtml(html)) {
                    loadHtml(html);
                    return;
                }
                cached.delete();
            }
        } catch (Exception ignored) {}
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void loadHtml(String html) {
        webView.loadDataWithBaseURL(
                "file:///android_asset/",
                html,
                "text/html",
                "UTF-8",
                null
        );
    }

    private String currentContent() throws Exception {
        File cached = updateFile();
        if (cached.exists()) {
            String html = readAll(new FileInputStream(cached));
            if (isValidAppHtml(html)) return html;
        }
        return readAll(getAssets().open("index.html"));
    }

    private String downloadLatestContent() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(REMOTE_INDEX_URL).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(18000);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("User-Agent", "Diagnostico-ER-Android-Updater");
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            connection.disconnect();
            throw new Exception("Servidor respondeu " + code);
        }
        String html = readAll(connection.getInputStream());
        connection.disconnect();
        if (!isValidAppHtml(html)) throw new Exception("Arquivo de atualização inválido");
        return html;
    }

    private boolean isValidAppHtml(String html) {
        return html != null
                && html.length() > 20000
                && html.contains("Diagnóstico E.R.")
                && html.contains("const SUPA=")
                && html.contains("<section id=\"home\"");
    }

    private String readAll(InputStream input) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        char[] buffer = new char[8192];
        int n;
        while ((n = reader.read(buffer)) != -1) out.append(buffer, 0, n);
        reader.close();
        return out.toString();
    }

    private String sha256(String text) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : bytes) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private void writeUpdate(String html) throws Exception {
        File target = updateFile();
        File temp = new File(getFilesDir(), UPDATE_FILE_NAME + ".tmp");
        FileOutputStream output = new FileOutputStream(temp);
        output.write(html.getBytes(StandardCharsets.UTF_8));
        output.flush();
        output.close();
        if (target.exists() && !target.delete()) throw new Exception("Não foi possível substituir a versão anterior");
        if (!temp.renameTo(target)) throw new Exception("Não foi possível salvar a atualização");
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "Android";
        }
    }

    private void sendUpdateStatus(boolean available, String message) {
        final String js = "window.onAndroidUpdateCheck&&window.onAndroidUpdateCheck("
                + available + "," + JSONObject.quote(message) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void sendApplyStatus(boolean ok, String message) {
        final String js = "window.onAndroidUpdateApplied&&window.onAndroidUpdateApplied("
                + ok + "," + JSONObject.quote(message) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    public class AndroidUpdaterBridge {
        @JavascriptInterface
        public String getVersionName() {
            return versionName();
        }

        @JavascriptInterface
        public void checkForUpdate() {
            new Thread(() -> {
                try {
                    String current = currentContent();
                    String latest = downloadLatestContent();
                    boolean different = !sha256(current).equals(sha256(latest));
                    sendUpdateStatus(
                            different,
                            different ? "Nova atualização disponível." : "Seu aplicativo já está atualizado."
                    );
                } catch (Exception e) {
                    sendUpdateStatus(false, "Não foi possível verificar agora: " + e.getMessage());
                }
            }).start();
        }

        @JavascriptInterface
        public void applyUpdate() {
            new Thread(() -> {
                try {
                    String latest = downloadLatestContent();
                    String current = currentContent();
                    if (sha256(current).equals(sha256(latest))) {
                        sendApplyStatus(true, "Seu aplicativo já está atualizado.");
                        return;
                    }
                    writeUpdate(latest);
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "Atualização aplicada com sucesso.", Toast.LENGTH_SHORT).show();
                        loadHtml(latest);
                    });
                } catch (Exception e) {
                    sendApplyStatus(false, "Falha ao atualizar: " + e.getMessage());
                }
            }).start();
        }

        @JavascriptInterface
        public void restoreBundledVersion() {
            runOnUiThread(() -> {
                try {
                    File cached = updateFile();
                    if (cached.exists()) cached.delete();
                    Toast.makeText(MainActivity.this, "Versão instalada restaurada.", Toast.LENGTH_SHORT).show();
                    webView.loadUrl("file:///android_asset/index.html");
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Não foi possível restaurar.", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
