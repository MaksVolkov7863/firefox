/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Creates a local listening socket that accepts connections without sending
 * a response, so loads stay pending until explicitly stopped.
 */
function createUnresponsiveURL() {
  let socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(
    Ci.nsIServerSocket
  );
  socket.init(-1, true, -1);
  registerCleanupFunction(() => {
    socket.close();
  });
  return `https://localhost:${socket.port}/`;
}

/**
 * Starting a navigation from about:home (without typing in the URL bar, e.g.
 * clicking a shortcut/link) and stopping it before commit must preserve the
 * target URL in the URL bar and allow reload to retry it.
 */
add_task(async function test_preserve_link_load_aborted_from_about_home() {
  const SLOW_URL = createUnresponsiveURL();
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:home");
  let browser = tab.linkedBrowser;

  is(browser.userTypedValue, null, "about:home starts with no userTypedValue");

  let stoppedPromise = BrowserTestUtils.browserStopped(browser, null, true);
  BrowserTestUtils.startLoadingURIString(browser, SLOW_URL);
  await TestUtils.waitForCondition(() => tab.hasAttribute("busy"));

  BrowserCommands.stop();
  await stoppedPromise;

  is(
    browser.userTypedValue,
    SLOW_URL,
    "Target URL should be preserved in userTypedValue after abort from about:home"
  );
  is(
    gURLBar.untrimmedValue,
    SLOW_URL,
    "URL bar should show the interrupted target URL"
  );
  ok(
    gBrowser.hasPreservedInterruptedURL(tab),
    "Tab should report a preserved interrupted URL"
  );
  ok(
    !document.getElementById("Browser:Reload").hasAttribute("disabled"),
    "Reload command should be enabled for preserved interrupted URL"
  );

  // Reloading should retry SLOW_URL instead of reloading about:home.
  let retryStarted = new Promise(resolve => {
    let listener = {
      onStateChange(aBrowser, aWebProgress, aRequest, aStateFlags) {
        if (
          aBrowser == browser &&
          aWebProgress.isTopLevel &&
          aStateFlags & Ci.nsIWebProgressListener.STATE_START &&
          aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK
        ) {
          let uri = aRequest?.QueryInterface(Ci.nsIChannel)?.originalURI?.spec;
          if (uri == SLOW_URL) {
            gBrowser.removeTabsProgressListener(listener);
            resolve();
          }
        }
      },
    };
    gBrowser.addTabsProgressListener(listener);
  });

  BrowserCommands.reload();
  await retryStarted;

  let secondStop = BrowserTestUtils.browserStopped(browser, null, true);
  BrowserCommands.stop();
  await secondStop;

  is(
    browser.userTypedValue,
    SLOW_URL,
    "Target URL should still be preserved if the retried load is stopped again"
  );

  BrowserTestUtils.removeTab(tab);
});

/**
 * Typing/pasting a URL on about:home when the tab has back history
 * (!tab.isEmpty) and stopping before commit must still preserve the URL.
 */
add_task(
  async function test_preserve_typed_url_aborted_on_about_home_with_history() {
    const SLOW_URL = createUnresponsiveURL();
    let tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "https://example.com/"
    );
    let browser = tab.linkedBrowser;

    let homeLoaded = BrowserTestUtils.browserLoaded(
      browser,
      false,
      "about:home"
    );
    BrowserTestUtils.startLoadingURIString(browser, "about:home");
    await homeLoaded;

    ok(browser.canGoBack, "about:home tab has back history");
    ok(!tab.isEmpty, "about:home tab with back history is not considered empty");

    let stoppedPromise = BrowserTestUtils.browserStopped(browser, null, true);
    gURLBar.value = SLOW_URL;
    gURLBar.handleCommand();
    await TestUtils.waitForCondition(() => tab.hasAttribute("busy"));

    BrowserCommands.stop();
    await stoppedPromise;

    is(
      browser.userTypedValue,
      SLOW_URL,
      "Typed URL should be preserved after abort on about:home with history"
    );
    is(
      gURLBar.untrimmedValue,
      SLOW_URL,
      "URL bar should keep the typed URL on about:home with history"
    );

    BrowserTestUtils.removeTab(tab);
  }
);

/**
 * Editing the URL bar after an aborted load must not cause reload to submit
 * the newer unsubmitted edit.
 */
add_task(async function test_reload_does_not_submit_newer_urlbar_edit() {
  const SLOW_URL = createUnresponsiveURL();
  let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  await BrowserTestUtils.switchTab(gBrowser, tab);
  let browser = tab.linkedBrowser;

  let stoppedPromise = BrowserTestUtils.browserStopped(browser, null, true);
  gURLBar.value = SLOW_URL;
  gURLBar.handleCommand();
  await TestUtils.waitForCondition(() => tab.hasAttribute("busy"));

  BrowserCommands.stop();
  await stoppedPromise;

  ok(
    gBrowser.hasPreservedInterruptedURL(tab),
    "Preserved URL should be tracked on about:blank"
  );
  ok(
    !document.getElementById("Browser:Reload").hasAttribute("disabled"),
    "Reload command should be enabled on about:blank with preserved URL"
  );

  // User edits the URL bar without pressing Enter.
  browser.userTypedValue = "https://unsubmitted.example/";
  ok(
    !gBrowser.hasPreservedInterruptedURL(tab),
    "hasPreservedInterruptedURL should be false once userTypedValue changed"
  );

  BrowserTestUtils.removeTab(tab);
});

/**
 * Stopping a pending load on an already-loaded webpage must continue to revert
 * the URL bar back to the committed webpage URL.
 */
add_task(async function test_loaded_webpage_still_reverts_on_stop() {
  const PAGE_URL = "https://example.com/";
  const SLOW_URL = createUnresponsiveURL();
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE_URL);
  let browser = tab.linkedBrowser;

  let stoppedPromise = BrowserTestUtils.browserStopped(browser, null, true);
  gURLBar.value = SLOW_URL;
  gURLBar.handleCommand();
  await TestUtils.waitForCondition(() => tab.hasAttribute("busy"));

  BrowserCommands.stop();
  await stoppedPromise;

  is(
    browser.userTypedValue,
    null,
    "userTypedValue should be cleared on an already-loaded webpage after stop"
  );
  is(
    gURLBar.untrimmedValue,
    PAGE_URL,
    "URL bar should revert to the loaded webpage URL after stop"
  );

  BrowserTestUtils.removeTab(tab);
});
