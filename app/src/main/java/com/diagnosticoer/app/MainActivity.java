package com.diagnosticoer.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import org.json.JSONArray;
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
    private static final String RELEASE_API_URL = "https://api.github.com/repos/Cuto1/diagnostico-er-app/releases/latest";
    private static final String APK_ASSET_NAME = "Diagnostico-ER-Sincronizacao.apk";
    private static final String UPDATE_FILE_NAME = "diagnostico_er_updated_index.html";
    private static final String APK_MIME = "application/vnd.android.package-archive";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private volatile ReleaseInfo pendingRelease;
    private volatile boolean waitingInstallPermission = false;
    private volatile long updateDownloadId = -1L;

    private static class ReleaseInfo {
        int versionCode;
        String versionName;
        String apkUrl;

        ReleaseInfo(int versionCode, String versionName, String apkUrl) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl;
        }
    }

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

    private HttpURLConnection openConnection(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "Diagnostico-ER-Android-Updater");
        return connection;
    }

    private String downloadText(String url) throws Exception {
        HttpURLConnection connection = openConnection(url);
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            connection.disconnect();
            throw new Exception("Servidor respondeu " + code);
        }
        String text = readAll(connection.getInputStream());
        connection.disconnect();
        return text;
    }

    private String downloadLatestContent() throws Exception {
        String html = downloadText(REMOTE_INDEX_URL);
        if (!isValidAppHtml(html)) throw new Exception("Arquivo de atualização inválido");
        return html;
    }

    private ReleaseInfo downloadLatestReleaseInfo() throws Exception {
        JSONObject json = new JSONObject(downloadText(RELEASE_API_URL));
        String tag = json.optString("tag_name", "");
        String digits = tag.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) throw new Exception("Versão publicada inválida");
        int code = Integer.parseInt(digits);
        String name = json.optString("name", tag);
        String apkUrl = "";

        JSONArray assets = json.optJSONArray("assets");
        if (assets != null) {
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.optJSONObject(i);
                if (asset != null && APK_ASSET_NAME.equals(asset.optString("name"))) {
                    apkUrl = asset.optString("browser_download_url", "");
                    break;
                }
            }
        }

        if (apkUrl.isEmpty()) throw new Exception("APK da atualização não encontrado");
        return new ReleaseInfo(code, name, apkUrl);
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
            String name = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            return name == null ? "Android" : name;
        } catch (Exception e) {
            return "Android";
        }
    }

    private long versionCode() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
            }
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return 0L;
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

    private void sendProgress(int percent, String message) {
        final String js = "window.onAndroidUpdateProgress&&window.onAndroidUpdateProgress("
                + percent + "," + JSONObject.quote(message) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getPackageManager().canRequestPackageInstalls();
    }

    private void beginApkUpdate(ReleaseInfo info) {
        pendingRelease = info;
        runOnUiThread(() -> {
            if (!canInstallPackages()) {
                waitingInstallPermission = true;
                sendProgress(0, "Autorize o Diagnóstico E.R. a instalar atualizações. Ao voltar, o download começará automaticamente.");
                try {
                    Intent settingsIntent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())
                    );
                    startActivity(settingsIntent);
                } catch (Exception e) {
                    waitingInstallPermission = false;
                    sendApplyStatus(false, "Não foi possível abrir a autorização de instalação.");
                }
                return;
            }
            startApkDownload(info);
        });
    }

    private void startApkDownload(ReleaseInfo info) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new Exception("Gerenciador de downloads indisponível");

            String fileName = "Diagnostico-ER-update-v" + info.versionCode + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(info.apkUrl));
            request.setTitle("Atualização do Diagnóstico E.R.");
            request.setDescription("Baixando " + info.versionName);
            request.setMimeType(APK_MIME);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);

            updateDownloadId = manager.enqueue(request);
            sendProgress(1, "Baixando a nova versão do aplicativo...");
            new Thread(() -> monitorApkDownload(manager, updateDownloadId)).start();
        } catch (Exception e) {
            sendApplyStatus(false, "Falha ao iniciar o download: " + e.getMessage());
        }
    }

    private void monitorApkDownload(DownloadManager manager, long downloadId) {
        long started = System.currentTimeMillis();

        while (System.currentTimeMillis() - started < 10 * 60 * 1000L) {
            Cursor cursor = null;
            try {
                DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
                cursor = manager.query(query);

                if (cursor != null && cursor.moveToFirst()) {
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));

                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        if (cursor != null) cursor.close();
                        Uri apkUri = manager.getUriForDownloadedFile(downloadId);
                        if (apkUri == null) {
                            sendApplyStatus(false, "Download concluído, mas o arquivo não pôde ser aberto.");
                            return;
                        }
                        runOnUiThread(() -> openInstaller(apkUri));
                        return;
                    }

                    if (status == DownloadManager.STATUS_FAILED) {
                        int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        sendApplyStatus(false, "Falha no download da atualização. Código " + reason + ".");
                        return;
                    }

                    if (total > 0) {
                        int pct = (int) Math.max(1, Math.min(99, (downloaded * 100L) / total));
                        sendProgress(pct, "Baixando atualização... " + pct + "%");
                    }
                }

                Thread.sleep(700);
            } catch (Exception e) {
                sendApplyStatus(false, "Falha durante o download: " + e.getMessage());
                return;
            } finally {
                if (cursor != null && !cursor.isClosed()) cursor.close();
            }
        }

        sendApplyStatus(false, "O download demorou demais. Tente novamente.");
    }

    private void openInstaller(Uri apkUri) {
        try {
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, APK_MIME);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(install);
            sendApplyStatus(true, "Download concluído. Confirme a instalação na tela do Android.");
        } catch (Exception e) {
            sendApplyStatus(false, "APK baixado, mas não foi possível abrir o instalador: " + e.getMessage());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingInstallPermission && pendingRelease != null && canInstallPackages()) {
            waitingInstallPermission = false;
            startApkDownload(pendingRelease);
        }
    }

    public class AndroidUpdaterBridge {
        @JavascriptInterface
        public String getVersionName() {
            return versionName();
        }

        @JavascriptInterface
        public long getVersionCode() {
            return versionCode();
        }

        @JavascriptInterface
        public void checkForUpdate() {
            new Thread(() -> {
                try {
                    ReleaseInfo release = null;
                    try {
                        release = downloadLatestReleaseInfo();
                        pendingRelease = release;
                    } catch (Exception ignored) {}

                    if (release != null && release.versionCode > versionCode()) {
                        sendUpdateStatus(
                                true,
                                "Nova versão do aplicativo disponível: " + release.versionName
                                        + " (código " + release.versionCode + ")."
                        );
                        return;
                    }

                    String current = currentContent();
                    String latest = downloadLatestContent();
                    boolean contentDifferent = !sha256(current).equals(sha256(latest));
                    sendUpdateStatus(
                            contentDifferent,
                            contentDifferent
                                    ? "Há uma atualização de conteúdo disponível."
                                    : "Seu aplicativo já está atualizado."
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
                    ReleaseInfo release = null;
                    try {
                        release = downloadLatestReleaseInfo();
                        pendingRelease = release;
                    } catch (Exception ignored) {}

                    if (release != null && release.versionCode > versionCode()) {
                        beginApkUpdate(release);
                        return;
                    }

                    String latest = downloadLatestContent();
                    String current = currentContent();
                    if (sha256(current).equals(sha256(latest))) {
                        sendApplyStatus(true, "Seu aplicativo já está atualizado.");
                        return;
                    }

                    writeUpdate(latest);
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "Conteúdo atualizado com sucesso.", Toast.LENGTH_SHORT).show();
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
                    Toast.makeText(MainActivity.this, "Conteúdo original do APK restaurado.", Toast.LENGTH_SHORT).show();
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
