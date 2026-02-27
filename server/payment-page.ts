/**
 * Ödeme ekranı ve ödeme biçimleri — eski script (bbbb_updated) ile birebir aynı yapı.
 * GET /payment → bu sayfa
 * GET /payment/form/:method → havale/form sayfası
 */

const CDN = "https://cdn-py.thesilent.link/payment";

// routes.ts ile aynı header + alt bar stilleri (menu-right, cw_mob_mav_fixed_bot)
const HEADER_NAV_STYLES = `
.topheader_user_info{color:var(--cwHeaderTxt,#fff);font-size:12px;gap:8px}.topheader_user_id{line-height:1.3}.topheader_user_deposit{width:36px;height:36px;border-radius:50%;background:var(--btn-primary,var(--cwButtonG,#45a049));display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;text-decoration:none}
.cw_mob_mav_fixed_bot{width:100%;height:var(--cwNavbarBottomHeight,76px);display:flex;align-items:center;position:fixed;bottom:0;left:0;right:0;border-radius:16px 16px 0 0;background-color:var(--cwDominantBg,#1a1e29);color:var(--cwDominantTxt,#fff);z-index:var(--cwZIndexFooter,120);box-shadow:0px -10px 15px 0px #00000073;transition:all 0.314s}.cw_mob_separator_menu{width:10px;flex-shrink:0}.cw_mob_mav_fixed_bot_main_action{width:40px;height:40px;border-radius:50%;background-color:var(--cwDominantBg2,#2a2d38);color:var(--cwDominantTxt,#fff);border:0;outline:0;display:flex;align-items:center;justify-content:center;margin-top:-8px;flex-shrink:0}.cw_mob_mav_fixed_primary_items_wrapper{display:flex;align-items:flex-start;justify-content:space-evenly;position:absolute;inset-inline-start:52px;top:0;transform:translateY(0);height:76px;width:calc(100% - 50px);padding-inline-end:17%}.cw_mob_mav_fixed_bot_item{width:25%;flex:0 0 25%;color:var(--cwDominantTxt2,#7a7e8a);border:0;outline:0;display:flex;flex-direction:column;align-items:center;background:transparent;padding-top:14px;text-decoration:none;font-size:10px}.cw_mob_mav_fixed_bot_item>i,.cw_mob_mav_fixed_bot_item>span{display:block;text-align:center}
#canli-destek-float{position:fixed;bottom:80px;right:12px;z-index:99990;cursor:pointer;transition:transform .2s,opacity .2s;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4))}#canli-destek-float:hover{transform:scale(1.05)}#canli-destek-float img{width:75px;height:auto;border:none;display:block}
`;

// routes.ts ile aynı yapı: div#menu-right (header değil, tek blok)
const HEADER_HTML = `
<div id="menu-right" style="position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--cwDominantBg,#1a1e29);border-bottom:1px solid rgba(255,255,255,0.08);">
  <a href="/tr/" style="text-decoration:none;display:flex;align-items:center;gap:6px;">
    <span style="font-size:15px;font-weight:800;color:#c8a94e;letter-spacing:1px;font-family:Arial Black,sans-serif;">GRANDPASHABET</span>
    <span style="font-size:8px;color:#8a9a5b;letter-spacing:2px;text-transform:uppercase;">CASINO &amp; SPORTS BETTING</span>
  </a>
  <div class="topheader_user_info" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
    <div class="topheader_user_id" style="display:flex;flex-direction:column;align-items:flex-end;">
      <span id="headerUsername" style="font-size:11px;color:var(--cwHeaderTxt2,#8a9a5b);">...</span>
      <span id="playerBalance" style="font-size:13px;font-weight:700;color:var(--cwHeaderTxt,#c8a94e);">0.00 TRY</span>
    </div>
    <a class="topheader_user_deposit" href="/payment" style="width:36px;height:36px;border-radius:50%;background:var(--btn-primary,#45a049);display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></a>
  </div>
</div>`;

// routes.ts'teki js_bn_nav_bar ile aynı yapı (PB = /tr)
const BOTTOM_NAV_HTML = `
<nav class="cw_mob_mav_fixed_bot" id="js_bn_nav_bar">
  <div class="cw_mob_separator_menu"></div>
  <button type="button" data-role="none" class="cw_mob_mav_fixed_bot_main_action js_bm_nav_items" onclick="window.location.href='/tr/'">
    <div style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></div>
  </button>
  <div class="cw_mob_mav_fixed_primary_items_wrapper with_switcher">
    <a data-role="none" class="cw_mob_mav_fixed_bot_item js_bm_nav_items" href="javascript:void(0)" onclick="event.preventDefault();if(window._openLiveChat)window._openLiveChat();">
      <i style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;margin-bottom:4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></i>
      <span><span>CANLI DESTEK</span></span>
    </a>
    <a data-role="none" class="cw_mob_mav_fixed_bot_item js_bm_nav_items" href="/tr/promotions/all.html" target="_self">
      <i style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;margin-bottom:4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="22"/><line x1="2" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="22" y2="12"/></svg></i>
      <span><span>\u00c7ARK</span></span>
    </a>
    <a data-role="none" class="cw_mob_mav_fixed_bot_item js_bm_nav_items" href="javascript:void(0)">
      <i style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;margin-bottom:4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg></i>
      <span><span>VIP CLUB</span></span>
    </a>
    <a data-role="none" class="cw_mob_mav_fixed_bot_item js_bm_nav_items" href="/tr/promotions/all.html" target="_self">
      <i style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;margin-bottom:4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg></i>
      <span><span>BONUSLAR</span></span>
    </a>
    <a data-role="none" class="cw_mob_mav_fixed_bot_item js_bm_nav_items cw_mob_mav_fixed_bot_item_btn cw_user_color_1" href="/tr/" id="js_nav_right_toggle_btn">
      <i style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;margin-bottom:4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></i>
      <span><span>PROF\u0130L</span></span>
    </a>
  </div>
</nav>`;

const CANLI_DESTEK_HTML = `
<div id="canli-destek-float">
  <img src="/images/canlimobil.png" alt="Canl\u0131 Destek" onerror="if(!this.dataset.e1){this.dataset.e1='1';this.src='/tr/images/canlimobil.png';return;}if(!this.dataset.e2){this.dataset.e2='1';this.src='/proxy/images/canlimobil.png';return;}this.onerror=null;this.src='data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22%3E%3Ccircle cx=%2240%22 cy=%2240%22 r=%2238%22 fill=%22%23708f00%22/%3E%3Cpath d=%22M22 26h36v20a8 8 0 0 1-8 8H36l-10 8v-16a8 8 0 0 1-4-7V26z%22 fill=%22white%22/%3E%3C/svg%3E';">
</div>`;

const USER_FETCH_SCRIPT = `
<script>
(function(){
  fetch('/api/auth/me',{credentials:'include'})
    .then(function(r){return r.json()})
    .then(function(me){
      if(me && me.loggedIn && me.username){
        var u=document.getElementById('headerUsername');
        if(u) u.textContent=me.userId ? 'ID: '+me.userId : me.username;
        fetch('/api/auth/balance?username='+encodeURIComponent(me.username),{credentials:'include'})
          .then(function(r){return r.json()})
          .then(function(d){
            if(d&&d.balance!=null){
              var b=document.getElementById('playerBalance');
              if(b) b.textContent=parseFloat(d.balance).toFixed(2)+' TRY';
            }
          }).catch(function(){});
      } else {
        var area=document.querySelector('#menu-right .topheader_user_info');
        if(area) area.innerHTML='<a href="/tr/" style="color:#c8a94e;text-decoration:none;font-size:13px;font-weight:600;">Giris Yap</a>';
      }
    })
    .catch(function(){});
  var floatBtn=document.getElementById('canli-destek-float');
  if(floatBtn) floatBtn.addEventListener('click',function(e){ e.preventDefault(); if(typeof Tawk_API!==\"undefined\"&&Tawk_API.maximize){ Tawk_API.maximize(); return; } var f=document.querySelector(\'iframe[src*=\"tawk\"]\'); if(f){ f.style.display=\"block\"; f.style.visibility=\"visible\"; f.style.zIndex=\"99999\"; } });
  window._openLiveChat=function(){ if(typeof Tawk_API!==\"undefined\"&&Tawk_API.maximize){ Tawk_API.maximize(); return; } if(floatBtn) floatBtn.click(); };
})();
</script>`;

function paymentCard(id: string, imgSrc: string, alt: string, minTry: string, maxTry: string, fee = "0 %") {
  const feeLine = fee ? `<li><h3 class="paymentItemWebstyled__StyledPaymentItemLabel-sc-1mnfrw0-10 paymentItemMobilestyled__StyledPaymentItemLabelMobile-sc-aojim5-5 kyavzu fsSLYj">Ücret: <span class="paymentItemWebstyled__StyledPaymentItemValue-sc-1mnfrw0-11 paymentItemMobilestyled__StyledPaymentItemValueMobile-sc-aojim5-6 cAlGgG kmokIh">${fee}</span></h3></li>` : "";
  return `
        <figure id="${id}" class="paymentItemWebstyled__StyledPaymentItem-sc-1mnfrw0-6 paymentItemMobilestyled__StyledPaymentItemMobile-sc-aojim5-0 jYVsge kbQzUW payment-method-card">
          <div class="paymentItemWebstyled__StyledPaymentItemLogoWrapper-sc-1mnfrw0-8 paymentItemMobilestyled__StyledPaymentItemLogoWrapperMobile-sc-aojim5-1 fMOVNh dRdprD">
            <img src="${imgSrc}" alt="${alt}" width="188" height="75">
          </div>
          <figcaption class="paymentItemMobilestyled__StyledPaymentItemFigcaptionMobile-sc-aojim5-4 dFlXKl">
            <ul class="paymentItemWebstyled__StyledPaymentItemFigcaptionList-sc-1mnfrw0-9 bMBoVZ">
              ${feeLine}
              <li><h3 class="paymentItemWebstyled__StyledPaymentItemLabel-sc-1mnfrw0-10 paymentItemMobilestyled__StyledPaymentItemLabelMobile-sc-aojim5-5 kyavzu fsSLYj">Min: <span class="paymentItemWebstyled__StyledPaymentItemValue-sc-1mnfrw0-11 paymentItemMobilestyled__StyledPaymentItemValueMobile-sc-aojim5-6 cAlGgG kmokIh">${minTry}</span></h3></li>
              <li><h3 class="paymentItemWebstyled__StyledPaymentItemLabel-sc-1mnfrw0-10 paymentItemMobilestyled__StyledPaymentItemLabelMobile-sc-aojim5-5 kyavzu fsSLYj">Maks: <span class="paymentItemWebstyled__StyledPaymentItemValue-sc-1mnfrw0-11 paymentItemMobilestyled__StyledPaymentItemValueMobile-sc-aojim5-6 cAlGgG kmokIh">${maxTry}</span></h3></li>
            </ul>
          </figcaption>
        </figure>`;
}

function section(title: string, count: number, cards: string) {
  return `
    <section class="paymentItemWebstyled__StyledPaymentItemSection-sc-1mnfrw0-3 dKNLWU">
      <div class="paymentItemWebstyled__StyledGroupNameWrapper-sc-1mnfrw0-1 paymentItemWebstyled__StyledGroupNameWrapperMobile-sc-1mnfrw0-2 dOkHCB hUYIRE">
        <h2 class="paymentItemWebstyled__StyledGroupName-sc-1mnfrw0-4 hdDxBC">${title} <span>${count}</span></h2>
      </div>
      <section class="paymentItemWebstyled__StyledPsWrapper-sc-1mnfrw0-5 listMobilestyled__StyledPsMobileWrapper-sc-z12ll3-1 iHwWCG fdjVzQ">
${cards}
      </section>
    </section>`;
}

export function getPaymentPageHtml(embed?: boolean): string {
  const havaleCards = [
    paymentCard("trend_havale", `${CDN}/8499f9b7-4666-469f-a0ee-85a274f38653.PNG`, "Havale", "1 500 TRY", "500 000 TRY"),
    paymentCard("star_havale", `${CDN}/5b21e9eb-50f3-40f2-b5fc-325f668d158e.PNG`, "Havale", "1 500 TRY", "1 000 000 TRY"),
    paymentCard("seri_havale", `${CDN}/59609af6-0714-48b5-b724-0a9f6915fb44.PNG`, "HillPaysHavaleLeft", "1 500 TRY", "100 000 TRY"),
    paymentCard("kolay_havale", `${CDN}/08c9ead8-6f57-43e4-a44f-427bff4cfe31.PNG`, "Havale", "1 500 TRY", "500 000 TRY"),
    paymentCard("garanti_havale", `${CDN}/41b9384f-6147-43fd-a45a-5a55e865bb5b.JPEG`, "Bank Transfer", "1 500 TRY", "1 000 000 TRY"),
    paymentCard("hizli_havale", `${CDN}/6511f4e5-f66d-4be8-8862-bba4f62f37bc.PNG`, "Havale", "1 500 TRY", "250 000 TRY"),
    paymentCard("grand_havale", `${CDN}/fe62161f-1f0d-4f9d-9965-e808776200c3.JPEG`, "Banka Havalesi", "1 500 TRY", "1 000 000 TRY"),
  ].join("\n");

  const kriptoCards = [
    paymentCard("hizli_kripto", `${CDN}/be67beb2-2654-4a32-bc5a-abf9066f1043.JPEG`, "Crypto", "1 500 TRY", "5 000 000 TRY"),
    paymentCard("turbo_kripto", `${CDN}/557aabb0-8cc2-47ee-b48a-6d6f4ea8db0f.PNG`, "Turbo Coin", "1 500 TRY", "1 000 000 TRY"),
  ].join("\n");

  const krediKartiCards = paymentCard("kredi_karti", `${CDN}/HillPaysCreditCard_142.png`, "HillPaysCreditCard", "1 500 TRY", "10 000 TRY");

  const eCuzdanCards = [
    paymentCard("aninda_papara", `${CDN}/PaparaV2_23.png`, "Aninda Papara V2", "1 500 TRY", "50 000 TRY"),
    paymentCard("payco", `${CDN}/Payco.png`, "PayCo", "1 500 TRY", "100 000 TRY"),
    paymentCard("hemen_papara", `${CDN}/HemenodeVipPapara.png`, "Hemen Papara", "1 500 TRY", "100 000 TRY"),
    paymentCard("parolapara", `${CDN}/Paralopara.png`, "Hemen Parolapara", "1 500 TRY", "250 000 TRY"),
    paymentCard("mefete", `${CDN}/03789f20-52e3-4c67-9da9-4df5878fa666.PNG`, "Mefete", "1 500 TRY", "100 000 TRY"),
    paymentCard("papel", `${CDN}/9290c1cd-d564-4be6-9cae-7d7e3fc8746b.PNG`, "Papel", "1 500 TRY", "250 000 TRY"),
    paymentCard("paratim", `${CDN}/Paratim_23.PNG`, "Paratim", "1 500 TRY", "200 000 TRY"),
    paymentCard("parolapara2", `${CDN}/a36840da-5183-4a6a-8776-c207f50f9952.PNG`, "Parolapara", "1 500 TRY", "250 000 TRY"),
    paymentCard("turbo_papara", `${CDN}/TurboPaparaNew.png`, "Turbo Papara", "1 500 TRY", "100 000 TRY"),
  ].join("\n");

  const eVoucherCards = paymentCard("aninda_qr", `${CDN}/QR.png`, "Aninda QR", "1 500 TRY", "10 000 TRY");

  /* bbbb_updated zip deposit.php ile birebir aynı tema */
  const styles = `
.cashier_wrapper .cashier_fixed_header { background-color: #708f00; border-bottom:1px solid #708f00; }
.heading { color: #fff; text-transform: uppercase; height: 39px; line-height: 39px; font-size: 14px; }
.alCen, .alcen { align-items: center; -webkit-box-align: center; }
.cashier_fixed_header .cashier_text { color: var(--cwModalTxt, #fff); }
.cashier_fixed_header .reg_close { color: var(--cwModalTxt3, #ccc); }
.jMyLWO { position: relative; display: flex; flex: 1 1 0%; min-height: 100vh; max-width: 420px; margin: 0px auto; }
.ekuWet { min-height: 100%; flex: 1 1 0%; padding: 12px 12px 40px; position: relative; background-color: rgb(39, 44, 17); }
.dKNLWU { margin-bottom: 12px; }
.dOkHCB { min-height: 28px; padding: 4px 12px; margin-bottom: 10px; background-color: rgb(67, 78, 24); border: 0px solid transparent; border-radius: 10px; }
.hdDxBC { display: flex; justify-content: space-between; align-items: center; flex-flow: row; gap: 0px; font-weight: 500; font-size: 13px; line-height: 22px; font-family: Roboto, sans-serif; color: rgb(210, 214, 194); }
.hUYIRE { margin-bottom: 8px; }
.iHwWCG { display: flex; flex-wrap: wrap; flex: 1 1 0%; justify-content: center; gap: 10px; width: 100%; }
.fdjVzQ { flex-direction: column; gap: 6px; align-items: center; width: 100%; }
.jYVsge { position: relative; width: 100%; max-width: 340px; display: flex; flex-direction: column; padding: 8px; gap: 8px; border: 0px; border-radius: 12px; box-shadow: rgba(166,169,81,0.3) 0px 1px 3px; background-color: rgb(58, 71, 14); transition: 300ms; cursor: pointer; overflow: hidden; margin: 0 auto; }
.jYVsge:hover { opacity: 0.95; transform: scale(1.01); }
.kbQzUW { flex-direction: row; align-items: center; width: 100%; padding: 6px 8px; gap: 10px; }
figure.paymentItemWebstyled__StyledPaymentItem-sc-1mnfrw0-6.paymentItemMobilestyled__StyledPaymentItemMobile-sc-aojim5-0.jYVsge.kbQzUW { margin-left: 0px; }
.paymentItemWebstyled__StyledPsWrapper-sc-1mnfrw0-5.listMobilestyled__StyledPsMobileWrapper-sc-z12ll3-1.iHwWCG.fdjVzQ {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: flex-start !important;
  width: 100% !important;
}
figure.payment-method-card {
  width: calc(100% - 20px) !important;
  max-width: 340px !important;
  margin: 0 auto !important;
  align-self: center !important;
}
.fMOVNh { position: relative; display: flex; justify-content: center; align-items: center; flex-flow: row; gap: 0px; height: 50px; background-color: rgb(255, 255, 255); border-radius: 12px; }
.dRdprD { height: 46px; width: 100px; padding: 3px; }
.fMOVNh img { max-width: 100%; height: 80%; width: auto; object-fit: contain; }
.dFlXKl { flex: 1 1 0%; padding: 6px 4px 6px 0px; }
.bMBoVZ { display: flex; flex-direction: column; gap: 4px; margin: 0px; list-style: none; padding: 0; }
.fsSLYj { width: 100%; line-height: 16px; font-size: 12px; }
.kyavzu { display: flex; align-items: center; flex-flow: row; justify-content: space-between; gap: 6px; color: rgb(210, 214, 194); font-weight: 500; font-size: 12px; line-height: 20px; font-family: Roboto, sans-serif; width: 100%; }
.kmokIh { color: rgb(210, 214, 194); }
.gUpvux { margin-top: 24px; }
.gHmECJ { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.dABAXd, .kyUsbp { padding: 12px 24px; border-radius: 12px; border: none; font-weight: 600; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.dABAXd { background: #708f00; color: #fff; }
.kyUsbp { background: rgb(67, 78, 24); color: rgb(210, 214, 194); }
`;

  const body = `
<main class="sc-kAyceB jMyLWO">
  <main class="listMobilestyled__StyledMobileMainWrapper-sc-z12ll3-0 ekuWet">
    ${section("Havale/FAST", 7, havaleCards)}
    ${section("Kripto Paralar", 2, kriptoCards)}
    ${section("Kredi Kartı", 1, krediKartiCards)}
    ${section("E-CÜZDAN", 9, eCuzdanCards)}
    ${section("E-Voucher / Prepaid", 1, eVoucherCards)}
    <div class="navigationTabsMobileOnestyled__StyledHideShowTab-sc-1c4d25a-0 gUpvux">
      <div class="navigationTabsWebOnestyled__StyledTabOneButtonsWrapper-sc-169wj2o-1 gHmECJ">
        <button type="button" class="navigationTabsWebOnestyled__StyledTabOneButton-sc-169wj2o-2 dABAXd">
          <svg width="25" height="24" viewBox="0 0 25 24" fill="none"><path d="M20.4318 12.8182C20.3244 12.8182 20.218 12.7971 20.1187 12.756C20.0194 12.7149 19.9292 12.6546 19.8532 12.5786C19.7772 12.5026 19.717 12.4124 19.6759 12.3131C19.6348 12.2139 19.6136 12.1075 19.6136 12V7.09091C19.6129 6.44014 19.3541 5.81623 18.8939 5.35607C18.4338 4.89591 17.8099 4.63707 17.1591 4.63636H7.34091C6.69014 4.63707 6.06623 4.89591 5.60607 5.35607C5.14591 5.81623 4.88707 6.44014 4.88636 7.09091V12C4.88636 12.217 4.80016 12.4251 4.64672 12.5785C4.49328 12.732 4.28518 12.8182 4.06818 12.8182C3.85119 12.8182 3.64308 12.732 3.48964 12.5785C3.3362 12.4251 3.25 12.217 3.25 12V7.09091C3.25127 6.00632 3.68269 4.96652 4.44961 4.19961C5.21652 3.43269 6.25632 3.00127 7.34091 3H17.1591C18.2437 3.00127 19.2835 3.43269 20.0504 4.19961C20.8173 4.96652 21.2487 6.00632 21.25 7.09091V12C21.25 12.1075 21.2289 12.2139 21.1878 12.3131C21.1467 12.4124 21.0864 12.5026 21.0104 12.5786C20.9344 12.6546 20.8442 12.7149 20.745 12.756C20.6457 12.7971 20.5393 12.8182 20.4318 12.8182Z" fill="white"/><path d="M17.9773 21H6.52273C6.30573 21 6.09762 20.9138 5.94419 20.7604C5.79075 20.6069 5.70455 20.3988 5.70455 20.1818C5.70455 19.9648 5.79075 19.7567 5.94419 19.6033C6.09762 19.4498 6.30573 19.3636 6.52273 19.3636H17.9773C18.1943 19.3636 18.4024 19.4498 18.5558 19.6033C18.7093 19.7567 18.7955 19.9648 18.7955 20.1818C18.7955 20.3988 18.7093 20.6069 18.5558 20.7604C18.4024 20.9138 18.1943 21 17.9773 21Z" fill="white"/><path d="M8.05035 18.5455H16.4511C17.0786 18.5388 17.6779 18.2836 18.1175 17.8357C18.5571 17.3879 18.8012 16.784 18.7962 16.1564V7.84357C18.8012 7.21604 18.5571 6.61214 18.1175 6.16429C17.6779 5.71645 17.0786 5.46121 16.4511 5.45455H8.05035C7.42284 5.46121 6.82357 5.71645 6.38396 6.16429C5.94435 6.61214 5.70028 7.21604 5.70527 7.84357V16.1564C5.70028 16.784 5.94435 17.3879 6.38396 17.8357C6.82357 18.2836 7.42284 18.5388 8.05035 18.5455Z" fill="white"/></svg>
          Yatırım
        </button>
        <button type="button" class="navigationTabsWebOnestyled__StyledTabOneButton-sc-169wj2o-2 kyUsbp" onclick="try{window.parent.openWithdrawalModal();}catch(e){window.location.href='/withdrawal';}">
          <svg width="25" height="24" viewBox="0 0 25 24" fill="none"><path d="M20.4318 12.8182C20.3244 12.8182 20.218 12.7971 20.1187 12.756C20.0194 12.7149 19.9292 12.6546 19.8532 12.5786C19.7772 12.5026 19.717 12.4124 19.6759 12.3131C19.6348 12.2139 19.6136 12.1075 19.6136 12V7.09091C19.6129 6.44014 19.3541 5.81623 18.8939 5.35607C18.4338 4.89591 17.8099 4.63707 17.1591 4.63636H7.34091C6.69014 4.63707 6.06623 4.89591 5.60607 5.35607C5.14591 5.81623 4.88707 6.44014 4.88636 7.09091V12C4.88636 12.217 4.80016 12.4251 4.64672 12.5785C4.49328 12.732 4.28518 12.8182 4.06818 12.8182C3.85119 12.8182 3.64308 12.732 3.48964 12.5785C3.3362 12.4251 3.25 12.217 3.25 12V7.09091C3.25127 6.00632 3.68269 4.96652 4.44961 4.19961C5.21652 3.43269 6.25632 3.00127 7.34091 3H17.1591C18.2437 3.00127 19.2835 3.43269 20.0504 4.19961C20.8173 4.96652 21.2487 6.00632 21.25 7.09091V12C21.25 12.1075 21.2289 12.2139 21.1878 12.3131C21.1467 12.4124 21.0864 12.5026 21.0104 12.5786C20.9344 12.6546 20.8442 12.7149 20.745 12.756C20.6457 12.7971 20.5393 12.8182 20.4318 12.8182Z" fill="#D2D6C2"/><path d="M17.9773 21H6.52273C6.30573 21 6.09762 20.9138 5.94419 20.7604C5.79075 20.6069 5.70455 20.3988 5.70455 20.1818C5.70455 19.9648 5.79075 19.7567 5.94419 19.6033C6.09762 19.4498 6.30573 19.3636 6.52273 19.3636H17.9773C18.1943 19.3636 18.4024 19.4498 18.5558 19.6033C18.7093 19.7567 18.7955 19.9648 18.7955 20.1818C18.7955 20.3988 18.7093 20.6069 18.5558 20.7604C18.4024 20.9138 18.1943 21 17.9773 21Z" fill="#D2D6C2"/><path d="M16.4504 5.45455H8.0497C7.42219 5.46121 6.82292 5.71645 6.38331 6.16429C5.94371 6.61214 5.69964 7.21604 5.70462 7.84357V16.1564C5.69964 16.784 5.94371 17.3879 6.38331 17.8357C6.82292 18.2836 7.42219 18.5388 8.0497 18.5455H16.4504C17.078 18.5388 17.6772 18.2836 18.1168 17.8357C18.5564 17.3879 18.8005 16.784 18.7955 16.1564V7.84357C18.8005 7.21604 18.5564 6.61214 18.1168 6.16429C17.6772 5.71645 17.078 5.46121 16.4504 5.45455Z" fill="#D2D6C2"/></svg>
          Çekim
        </button>
      </div>
    </div>
  </main>
</main>

<script>
document.querySelectorAll('.payment-method-card').forEach(function(card) {
  card.addEventListener('click', function() {
    var methodId = this.getAttribute('id');
    if (!methodId) return;
    window.location.href = '/payment/form/' + encodeURIComponent(methodId);
  });
});
</script>`;

  const bodyStyle = embed
    ? "body { margin: 0; background: rgb(39,44,17); color: rgb(210,214,194); font-family: Roboto, sans-serif; }"
    : "body { padding-bottom: 80px; margin: 0; background: rgb(39,44,17); color: rgb(210,214,194); font-family: Roboto, sans-serif; }";
  const headerNavStyles = embed ? "" : HEADER_NAV_STYLES;
  const headerBlock = embed ? "" : HEADER_HTML;
  const canliBlock = embed ? "" : CANLI_DESTEK_HTML;
  const bottomNavBlock = embed ? "" : BOTTOM_NAV_HTML;
  const userScriptBlock = embed ? "" : USER_FETCH_SCRIPT;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Para Yatırma - Ödeme Yöntemleri</title>
  <style>${styles}
${headerNavStyles}
${bodyStyle}
</style>
</head>
<body>
${headerBlock}
${body}
${canliBlock}
${bottomNavBlock}
${userScriptBlock}
</body>
</html>`;
}

const PROVIDER_LOGOS: Record<string, string> = {
  trend_havale: `${CDN}/8499f9b7-4666-469f-a0ee-85a274f38653.PNG`,
  star_havale: `${CDN}/5b21e9eb-50f3-40f2-b5fc-325f668d158e.PNG`,
  seri_havale: `${CDN}/59609af6-0714-48b5-b724-0a9f6915fb44.PNG`,
  kolay_havale: `${CDN}/08c9ead8-6f57-43e4-a44f-427bff4cfe31.PNG`,
  garanti_havale: `${CDN}/41b9384f-6147-43fd-a45a-5a55e865bb5b.JPEG`,
  hizli_havale: `${CDN}/6511f4e5-f66d-4be8-8862-bba4f62f37bc.PNG`,
  grand_havale: `${CDN}/fe62161f-1f0d-4f9d-9965-e808776200c3.JPEG`,
  hizli_kripto: `${CDN}/be67beb2-2654-4a32-bc5a-abf9066f1043.JPEG`,
  turbo_kripto: `${CDN}/557aabb0-8cc2-47ee-b48a-6d6f4ea8db0f.PNG`,
  kredi_karti: `${CDN}/HillPaysCreditCard_142.png`,
  aninda_papara: `${CDN}/PaparaV2_23.png`,
  payco: `${CDN}/Payco.png`,
  hemen_papara: `${CDN}/HemenodeVipPapara.png`,
  parolapara: `${CDN}/Paralopara.png`,
  mefete: `${CDN}/03789f20-52e3-4c67-9da9-4df5878fa666.PNG`,
  papel: `${CDN}/9290c1cd-d564-4be6-9cae-7d7e3fc8746b.PNG`,
  paratim: `${CDN}/Paratim_23.PNG`,
  parolapara2: `${CDN}/a36840da-5183-4a6a-8776-c207f50f9952.PNG`,
  turbo_papara: `${CDN}/TurboPaparaNew.png`,
  aninda_qr: `${CDN}/QR.png`,
};

const METHOD_DISPLAY_NAMES: Record<string, string> = {
  trend_havale: "Trend Havale", star_havale: "Star Havale", seri_havale: "Seri Havale",
  kolay_havale: "Kolay Havale", garanti_havale: "Garanti Havale", hizli_havale: "Hızlı Havale",
  grand_havale: "Grand Havale", hizli_kripto: "Hızlı Kripto", turbo_kripto: "Turbo Kripto",
  kredi_karti: "Kredi Kartı", aninda_papara: "Anında Papara", payco: "PayCo",
  hemen_papara: "Hemen Papara", parolapara: "Parolapara", mefete: "Mefete",
  papel: "Papel", paratim: "Paratim", parolapara2: "Parolapara", turbo_papara: "Turbo Papara",
  aninda_qr: "Anında QR",
};

const METHOD_LIMITS: Record<string, { min: string; max: string }> = {
  trend_havale: { min: "1 500", max: "500 000" }, star_havale: { min: "1 500", max: "1 000 000" },
  seri_havale: { min: "1 500", max: "100 000" }, kolay_havale: { min: "1 500", max: "500 000" },
  garanti_havale: { min: "1 500", max: "1 000 000" }, hizli_havale: { min: "1 500", max: "250 000" },
  grand_havale: { min: "1 500", max: "1 000 000" }, hizli_kripto: { min: "1 500", max: "5 000 000" },
  turbo_kripto: { min: "1 500", max: "1 000 000" }, kredi_karti: { min: "1 500", max: "10 000" },
  aninda_papara: { min: "1 500", max: "50 000" }, payco: { min: "1 500", max: "100 000" },
  hemen_papara: { min: "1 500", max: "100 000" }, parolapara: { min: "1 500", max: "250 000" },
  mefete: { min: "1 500", max: "100 000" }, papel: { min: "1 500", max: "250 000" },
  paratim: { min: "1 500", max: "200 000" }, parolapara2: { min: "1 500", max: "250 000" },
  turbo_papara: { min: "1 500", max: "100 000" }, aninda_qr: { min: "1 500", max: "10 000" },
};

function getProviderSlider(activeMethod: string): string {
  const items = Object.entries(PROVIDER_LOGOS).map(([id, logo]) => {
    const isActive = id === activeMethod ? ' active' : '';
    return `<a class="provider-slider-item${isActive}" href="/payment/form/${id}"><img src="${logo}" alt="${id}"></a>`;
  }).join('');
  return `<div class="provider-slider">${items}</div>`;
}

function getMethodHeader(method: string): string {
  const name = METHOD_DISPLAY_NAMES[method] || method;
  const limits = METHOD_LIMITS[method] || { min: "1 500", max: "500 000" };
  return `
<div class="method-header">
  <a class="back-btn" href="javascript:void(0)" onclick="history.back()">\u2039</a>
  <span class="method-name">${name}</span>
  <span class="menu-btn">\u22EE</span>
</div>
<div class="method-info">
  <div class="method-info-row"><span>Min/Maks:</span><span>${limits.min} - ${limits.max} TRY</span></div>
  <div class="method-info-row"><span>Ücret:</span><span>0 %</span></div>
</div>`;
}

const HAVALE_FORM_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body, html { width: 100%; min-height: 100%; font-family: Roboto, 'Segoe UI', -apple-system, sans-serif; background: rgb(39,44,17); color: rgb(210,214,194); }

.provider-slider { display: flex; gap: 8px; padding: 12px 16px; overflow-x: auto; background: rgb(39,44,17); border-bottom: 1px solid rgba(112,143,0,0.15); }
.provider-slider::-webkit-scrollbar { display: none; }
.provider-slider-item { flex-shrink: 0; width: 80px; height: 40px; background: #fff; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s; }
.provider-slider-item.active { border-color: #708f00; }
.provider-slider-item img { max-width: 68px; max-height: 32px; object-fit: contain; }

.method-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; }
.method-header .back-btn { color: rgb(210,214,194); font-size: 20px; cursor: pointer; padding: 4px 8px; text-decoration: none; }
.method-header .method-name { font-size: 14px; font-weight: 600; color: #fff; flex: 1; text-align: center; }
.method-header .menu-btn { color: rgb(210,214,194); font-size: 18px; cursor: pointer; padding: 4px 8px; }

.method-info { padding: 0 24px 8px; }
.method-info-row { display: flex; justify-content: space-between; font-size: 13px; color: rgb(210,214,194); margin-bottom: 4px; }
.method-info-row span:last-child { color: #fff; font-weight: 500; }

.page-wrapper { padding: 16px; }

.login100-form { width: 100%; background: transparent; padding: 0 8px; color: rgb(210,214,194); }
.form-title { text-align: left; font-size: 13px; font-weight: 500; color: rgb(210,214,194); margin-bottom: 12px; }

.wrap-input100 { width: 100%; position: relative; background: rgb(58,71,14); border-radius: 12px; margin-bottom: 12px; padding: 0; border: 1px solid rgba(112,143,0,0.3); }
.input100 { font-size: 14px; color: #fff; line-height: 1.2; display: block; width: 100%; height: 48px; background: transparent; padding: 12px 14px; border: none; outline: none; border-radius: 12px; }
.input100::placeholder { color: rgba(210,214,194,0.5); }
select.input100 { appearance: auto; -webkit-appearance: auto; padding: 12px 14px; cursor: pointer; color: rgb(210,214,194); }
select.input100 option { background: rgb(58,71,14); color: #fff; }
.focus-input100 { display: none; }
.input-label { font-size: 12px; color: rgba(210,214,194,0.7); padding: 8px 14px 0; display: block; }
.input-suffix { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 13px; color: rgba(210,214,194,0.5); font-weight: 500; }
.input-wrapper { position: relative; }

.container-login100-form-btn { display: flex; justify-content: center; padding-top: 16px; margin-top: 8px; }
.wrap-login100-form-btn { width: 100%; }
.login100-form-bgbtn { display: none; }
.login100-form-btn { font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 0.5px; text-transform: uppercase; display: flex; justify-content: center; align-items: center; width: 100%; height: 48px; border: none; background: #708f00; border-radius: 12px; cursor: pointer; transition: background 0.2s; }
.login100-form-btn:hover { background: #5a7300; }
.login100-form-btn.green-btn { background: #5cb85c; }
.login100-form-btn.green-btn:hover { background: #4cae4c; }
.login100-form-btn.red-btn { background: #c0392b; }
.login100-form-btn.red-btn:hover { background: #a93226; }

h5 { color: rgb(210,214,194); font-size: 14px; line-height: 1.7; margin-bottom: 8px; text-align: center; }
h7 { color: rgb(210,214,194); font-size: 13px; line-height: 1.7; display: block; margin-bottom: 6px; text-align: center; }
p { color: rgba(210,214,194,0.7); font-size: 13px; margin: 10px 0 2px; text-align: center; }
b { color: #fff; font-size: 15px; word-break: break-all; display: block; text-align: center; margin: 2px 0 4px; }
h6 { color: rgb(210,214,194); text-align: center; }
#form2 center { color: rgb(210,214,194); }
#form3 center { color: rgb(210,214,194); }

.btn { padding: 8px 20px; border-radius: 12px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; transition: opacity 0.2s; }
.btn:hover { opacity: 0.85; }
.btn-warning { background: rgba(112,143,0,0.4); color: #fff; border: 1px solid rgba(112,143,0,0.5); }
.btn-success { background: #708f00; color: #fff; padding: 14px 24px; font-size: 15px; font-weight: 700; border-radius: 12px; width: 100%; display: flex; justify-content: center; margin-top: 10px; }
.btn-sm { padding: 5px 14px; font-size: 12px; }
hr { border: none; border-top: 1px solid rgba(112,143,0,0.2); margin: 14px 0; }

#loader { text-align: center; padding: 30px 0; }
#loader h5 { color: rgb(210,214,194); font-size: 15px; }
.spinner { margin: 20px auto; width: 50px; height: 40px; text-align: center; }
.spinner > div { background-color: #708f00; height: 100%; width: 6px; display: inline-block; margin: 0 2px; animation: sk-stretchdelay 1.2s infinite ease-in-out; }
.spinner .rect2 { animation-delay: -1.1s; } .spinner .rect3 { animation-delay: -1s; } .spinner .rect4 { animation-delay: -0.9s; } .spinner .rect5 { animation-delay: -0.8s; }
@keyframes sk-stretchdelay { 0%, 40%, 100% { transform: scaleY(0.4); } 20% { transform: scaleY(1); } }

.o-circle { display: flex; width: 9rem; height: 9rem; justify-content: center; align-items: flex-start; border-radius: 50%; margin: 10px auto 20px; animation: circle-appearance .8s ease-in-out 1 forwards; }
.o-circle__sign--success { background: #708f00; }
.o-circle__sign { position: relative; opacity: 0; background: #fff; width: 0.9rem; height: 5rem; border-radius: 50% 50% 50% 0% / 10%; transform: translateX(130%) translateY(35%) rotate(45deg) scale(1); animation: success-sign-appearance .8s ease-in-out .2s 1 forwards; }
@keyframes circle-appearance { 0% { transform: scale(0); } 50% { transform: scale(1.5); } 60% { transform: scale(1); } 100% { transform: scale(1); } }
@keyframes success-sign-appearance { 50% { opacity: 1; transform: translateX(130%) translateY(35%) rotate(45deg) scale(1.7); } 100% { opacity: 1; transform: translateX(130%) translateY(35%) rotate(45deg) scale(1); } }

`;

const BANK_OPTIONS = `
<option value="">Bankanızı Seçiniz.</option>
<option value="Akbank">Akbank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Aktif Bank">Aktif Bank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Albaraka Türk Bankası">Albaraka Türk Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Alternatif Bank">Alternatif Bank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="DenizBank">DenizBank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Enpara">Enpara (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Fast">Fast (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Fibabank">Fibabank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Garanti Bankası">Garanti Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Halkbank">Halkbank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="ING Bank">ING Bank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="İş Bankası">İş Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Kuveyt Türk Bankası">Kuveyt Türk Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Odeabank">Odeabank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Papara">Papara (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="PTT Bank">PTT Bank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="QNB Finansbank">QNB Finansbank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Şekerbank">Şekerbank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="TEB">TEB (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Türkiye Finans Bankası">Türkiye Finans Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Vakıf Katılım Bankası">Vakıf Katılım Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="VakıfBank">VakıfBank (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Yapıkredi Bankası">Yapıkredi Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Ziraat Bankası">Ziraat Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
<option value="Ziraat Katılım Bankası">Ziraat Katılım Bankası (Min: 1,500.00 TL - Maks: 100,000.00 TL)</option>
`;

function wrapPage(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${HAVALE_FORM_STYLES}</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

const COMMON_SCRIPTS = `
function CopyToClipboard(id) {
  var el = document.getElementById(id);
  if (navigator.clipboard) { navigator.clipboard.writeText(el.textContent); } else { var ta = document.createElement('textarea'); ta.value = el.textContent; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
}
function success() {
  document.getElementById('loader').style.display = 'block';
  document.getElementById('form2').style.display = 'none';
  var username = 'misafir';
  try { username = window.parent.__proxyUsername || username; } catch(ex) {}
  var amount = document.getElementById('miktar') ? document.getElementById('miktar').value : '0';
  var method = window.__paymentMethod || 'havale';
  fetch('/api/payment/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username: username, amount: amount, method: method })
  }).catch(function(){});
  setTimeout(function() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('form3').style.display = 'block';
    setTimeout(function() { try { var bd=window.parent.document.getElementById('payment-sheet-backdrop'); if(bd) bd.classList.remove('open'); } catch(e) {} }, 2500);
  }, 1500);
}
function getUsername() {
  return fetch('/api/auth/me', { credentials: 'include' }).then(function(r){ return r.json(); }).then(function(me) {
    return (me && me.username) ? me.username : 'misafir';
  }).catch(function() { return 'misafir'; });
}
`;

const SUCCESS_FORM = `
<form class="login100-form" id="form3" style="display:none;">
  <center>
    <div class="o-circle c-container__circle o-circle__sign--success"><div class="o-circle__sign"></div></div>
    <hr><h5>Yatırım talebiniz başarıyla oluşturulmuştur. Kontrollerin ardından yatırımınız üyeliğinize yansıyacaktır.<br>Siteye Yönlendiriliyorsunuz Lütfen Bekleyiniz.</h5><hr>
  </center>
</form>`;

const LOADER = `
<div id="loader" style="display:none;color:#fff;text-align:center;">
  <h5>İşleminiz Kontrol Ediliyor Lütfen Bekleyiniz.</h5>
  <div class="spinner"><div class="rect1"></div><div class="rect2"></div><div class="rect3"></div><div class="rect4"></div><div class="rect5"></div></div>
</div>`;

function getHavaleFormBody(method: string): string {
  const slider = getProviderSlider(method);
  const header = getMethodHeader(method);
  return `
${slider}
${header}
<div class="page-wrapper">
  ${LOADER}
  <form class="login100-form validate-form" action="#" onsubmit="return gonderHavale();" id="form1">
    <div class="form-title">Tutar</div>
    <div class="wrap-input100">
      <div class="input-wrapper">
        <input class="input100" type="number" name="miktar" id="miktar" step="0.01" value="" placeholder="Tutar" required>
        <span class="input-suffix">TRY</span>
      </div>
    </div>
    <div class="wrap-input100">
      <select class="input100" id="banka">${BANK_OPTIONS}</select>
    </div>
    <div class="container-login100-form-btn">
      <div class="wrap-login100-form-btn">
        <button type="submit" class="login100-form-btn">Para Yatırma</button>
      </div>
    </div>
  </form>
  <form class="login100-form" id="form2" style="display:none;">
    <center>
      <h7>İşlem Süresince <b>Kesinlikle</b> Sayfadan Ayrılmayınız.</h7>
      <h7><b>Açıklama bölümünü lütfen boş bırakınız veya adınızı soyadınızı yazınız.</b></h7>
      <h7>Lütfen Aşağıdaki Banka Hesabına sadece kendi adınızla yatırım gerçekleştiriniz.</h7>
      <p>Hesap Sahibi :</p><b id="ppname">-</b>
      <button class="btn btn-warning btn-sm" type="button" onclick="CopyToClipboard('ppname')">&#128203; Kopyala</button>
      <p>IBAN :</p><b id="ppno">-</b>
      <button class="btn btn-warning btn-sm" type="button" onclick="CopyToClipboard('ppno')">&#128203; Kopyala</button>
      <hr>
      <h7>Yatırım Yapmanızın Ardından Yatırımı Gerçekleştirdim Butonuna Tıklayınız.</h7>
      <div class="container-login100-form-btn">
        <button class="btn btn-success" type="button" onclick="success()">Yatırımı Gerçekleştirdim</button>
      </div>
    </center>
  </form>
  ${SUCCESS_FORM}
</div>
<script>
${COMMON_SCRIPTS}
window.__paymentMethod = 'havale';
function gonderHavale() {
  var miktar = document.getElementById('miktar').value;
  var banka = document.getElementById('banka').value;
  if (!banka) { alert('Bankanızı Seçiniz.'); return false; }
  if (!miktar || isNaN(parseFloat(miktar))) { alert('Lütfen yatırım tutarını giriniz.'); return false; }
  if (parseFloat(miktar) < 1500 || parseFloat(miktar) > 1000000) {
    alert('Alt yatırım tutarı 1500 TL\\'dir, girdiğiniz tutara uygun hesap bulunamamaktadır.');
    return false;
  }
  document.getElementById('form1').style.display = 'none';
  document.getElementById('loader').style.display = 'block';
  getUsername().then(function(username) {
    fetch('/api/payment/havale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: username, amount: parseFloat(miktar) })
    }).then(function(r){ return r.json(); }).then(function(data) {
      document.getElementById('loader').style.display = 'none';
      if (data.success && data.bankAccount) {
        document.getElementById('ppname').textContent = data.bankAccount.name || '-';
        document.getElementById('ppno').textContent = data.bankAccount.iban || '-';
        document.getElementById('form2').style.display = 'block';
      } else {
        alert(data.error || 'Bir hata oluştu');
        document.getElementById('form1').style.display = 'block';
      }
    }).catch(function() { document.getElementById('loader').style.display = 'none'; document.getElementById('form1').style.display = 'block'; alert('Bağlantı hatası'); });
  });
  return false;
}
</script>`;
}

function getPaparaFormBody(method: string): string {
  const slider = getProviderSlider(method);
  const header = getMethodHeader(method);
  return `
${slider}
${header}
<div class="page-wrapper">
  ${LOADER}
  <form class="login100-form validate-form" action="#" onsubmit="return gonderPapara();" id="form1">
    <div class="form-title">Tutar</div>
    <div class="wrap-input100">
      <div class="input-wrapper">
        <input class="input100" type="number" name="miktar" id="miktar" step="0.01" value="" placeholder="Tutar" required>
        <span class="input-suffix">TRY</span>
      </div>
    </div>
    <div class="container-login100-form-btn">
      <div class="wrap-login100-form-btn">
        <button type="submit" class="login100-form-btn">Para Yatırma</button>
      </div>
    </div>
  </form>
  <form class="login100-form" id="form2" style="display:none;">
    <center>
      <h7>İşlem Süresince <b>Kesinlikle</b> Sayfadan Ayrılmayınız.</h7>
      <h7><b>Açıklama bölümünü lütfen boş bırakınız veya adınızı soyadınızı yazınız.</b></h7>
      <h7>Lütfen Aşağıdaki Papara Hesabına sadece kendi hesabınızla yatırım gerçekleştiriniz.</h7>
      <p>Hesap Sahibi :</p><b id="ppname">-</b>
      <button class="btn btn-warning btn-sm" type="button" onclick="CopyToClipboard('ppname')">&#128203; Kopyala</button>
      <p>Papara No :</p><b id="ppno">-</b>
      <button class="btn btn-warning btn-sm" type="button" onclick="CopyToClipboard('ppno')">&#128203; Kopyala</button>
      <p>IBAN :</p><b id="ppiban">-</b>
      <button class="btn btn-warning btn-sm" type="button" onclick="CopyToClipboard('ppiban')">&#128203; Kopyala</button>
      <hr>
      <h7>Yatırım Yapmanızın Ardından Yatırımı Gerçekleştirdim Butonuna Tıklayınız.</h7>
      <div class="container-login100-form-btn">
        <button class="btn btn-success" type="button" onclick="success()">Yatırımı Gerçekleştirdim</button>
      </div>
    </center>
  </form>
  ${SUCCESS_FORM}
</div>
<script>
${COMMON_SCRIPTS}
window.__paymentMethod = 'papara';
function gonderPapara() {
  var miktar = document.getElementById('miktar').value;
  if (!miktar || isNaN(parseFloat(miktar))) { alert('Lütfen yatırım tutarını giriniz.'); return false; }
  if (parseFloat(miktar) < 1500 || parseFloat(miktar) > 100000) {
    alert('Tutar 1500 - 100000 TL arasında olmalıdır.');
    return false;
  }
  document.getElementById('form1').style.display = 'none';
  document.getElementById('loader').style.display = 'block';
  getUsername().then(function(username) {
    fetch('/api/payment/papara', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: username, amount: parseFloat(miktar) })
    }).then(function(r){ return r.json(); }).then(function(data) {
      document.getElementById('loader').style.display = 'none';
      if (data.success && data.paparaAccount) {
        document.getElementById('ppname').textContent = data.paparaAccount.accountName || '-';
        document.getElementById('ppno').textContent = data.paparaAccount.no || '-';
        document.getElementById('ppiban').textContent = data.paparaAccount.iban || '-';
        document.getElementById('form2').style.display = 'block';
      } else {
        alert(data.error || 'Bir hata oluştu');
        document.getElementById('form1').style.display = 'block';
      }
    }).catch(function() { document.getElementById('loader').style.display = 'none'; document.getElementById('form1').style.display = 'block'; alert('Bağlantı hatası'); });
  });
  return false;
}
</script>`;
}

function getKrediKartiFormBody(method: string): string {
  const slider = getProviderSlider(method);
  const header = getMethodHeader(method);
  return `
${slider}
${header}
<div class="page-wrapper">
  ${LOADER}
  <form class="login100-form validate-form" action="#" onsubmit="return gonderKK();" id="form1">
    <div class="form-title">Kredi Kartı Bilgileri</div>
    <div class="wrap-input100">
      <div class="input-wrapper">
        <input class="input100" type="number" name="miktar" id="miktar" step="0.01" value="" placeholder="Miktar (TL)" required>
        <span class="input-suffix">TRY</span>
      </div>
    </div>
    <div class="wrap-input100">
      <input class="input100" type="text" name="ccOwner" id="ccOwner" placeholder="Kart Sahibi Ad Soyad" required>
    </div>
    <div class="wrap-input100">
      <input class="input100" type="text" name="ccNo" id="ccNo" maxlength="19" placeholder="Kart Numarası" required>
    </div>
    <div style="display:flex;gap:10px;">
      <div class="wrap-input100" style="flex:1;">
        <select class="input100" id="ccMonth" required>
          <option value="">Ay</option>
          <option value="01">01</option><option value="02">02</option><option value="03">03</option>
          <option value="04">04</option><option value="05">05</option><option value="06">06</option>
          <option value="07">07</option><option value="08">08</option><option value="09">09</option>
          <option value="10">10</option><option value="11">11</option><option value="12">12</option>
        </select>
      </div>
      <div class="wrap-input100" style="flex:1;">
        <select class="input100" id="ccYear" required>
          <option value="">Yıl</option>
          <option value="2025">2025</option><option value="2026">2026</option><option value="2027">2027</option>
          <option value="2028">2028</option><option value="2029">2029</option><option value="2030">2030</option>
          <option value="2031">2031</option><option value="2032">2032</option><option value="2033">2033</option>
          <option value="2034">2034</option><option value="2035">2035</option>
        </select>
      </div>
    </div>
    <div class="wrap-input100">
      <input class="input100" type="text" name="ccCvc" id="ccCvc" maxlength="4" placeholder="CVC/CVV" required>
    </div>
    <div class="container-login100-form-btn">
      <div class="wrap-login100-form-btn">
        <button type="submit" class="login100-form-btn">Para Yatırma</button>
      </div>
    </div>
  </form>
  <form class="login100-form" id="form2" style="display:none;">
    <center>
      <h5>Ödemeniz işleniyor, lütfen bekleyiniz...</h5>
    </center>
  </form>
  ${SUCCESS_FORM}
</div>
<script>
${COMMON_SCRIPTS}
window.__paymentMethod = 'kredikarti';
function gonderKK() {
  var miktar = document.getElementById('miktar').value;
  var ccOwner = document.getElementById('ccOwner').value;
  var ccNo = document.getElementById('ccNo').value.replace(/\\s/g, '');
  var ccMonth = document.getElementById('ccMonth').value;
  var ccYear = document.getElementById('ccYear').value;
  var ccCvc = document.getElementById('ccCvc').value;
  if (!ccOwner || !ccNo || !ccMonth || !ccYear || !ccCvc) { alert('Tüm kart bilgilerini doldurunuz.'); return false; }
  if (ccNo.length < 15 || ccNo.length > 16) { alert('Geçerli bir kart numarası giriniz.'); return false; }
  if (!miktar || isNaN(parseFloat(miktar))) { alert('Lütfen yatırım tutarını giriniz.'); return false; }
  if (parseFloat(miktar) < 1500 || parseFloat(miktar) > 10000) {
    alert('Tutar 1500 - 10000 TL arasında olmalıdır.');
    return false;
  }
  document.getElementById('form1').style.display = 'none';
  document.getElementById('loader').style.display = 'block';
  getUsername().then(function(username) {
    fetch('/api/payment/kredikarti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: username, amount: parseFloat(miktar), ccOwner: ccOwner, ccNo: ccNo, ccCvc: ccCvc, ccMonth: ccMonth, ccYear: ccYear })
    }).then(function(r){ return r.json(); }).then(function(data) {
      document.getElementById('loader').style.display = 'none';
      if (data.success) {
        document.getElementById('form2').style.display = 'block';
        setTimeout(function() {
          document.getElementById('form2').style.display = 'none';
          document.getElementById('form3').style.display = 'block';
          setTimeout(function() { try { var bd=window.parent.document.getElementById('payment-sheet-backdrop'); if(bd) bd.classList.remove('open'); } catch(e) {} }, 2500);
        }, 2000);
      } else {
        alert(data.error || 'Bir hata oluştu');
        document.getElementById('form1').style.display = 'block';
      }
    }).catch(function() { document.getElementById('loader').style.display = 'none'; document.getElementById('form1').style.display = 'block'; alert('Bağlantı hatası'); });
  });
  return false;
}
document.getElementById('ccNo').addEventListener('input', function(e) {
  var v = e.target.value.replace(/\\D/g, '');
  var formatted = v.replace(/(\\d{4})(?=\\d)/g, '$1 ');
  e.target.value = formatted;
});
</script>`;
}

export function getWithdrawalPageHtml(embed?: boolean): string {
  const withdrawalBody = `
<div class="method-header">
  <a class="back-btn" href="javascript:void(0)" onclick="history.back()">\u2039</a>
  <span class="method-name">Para Çekme</span>
  <span class="menu-btn">\u22EE</span>
</div>
<div class="page-wrapper">
  ${LOADER}
  <form class="login100-form validate-form" action="#" onsubmit="return gonderCekim();" id="formCekim">
    <div class="form-title">Para Çekme Talebi</div>

    <div class="wrap-input100">
      <select class="input100" name="cekim_method" id="cekim_method" required>
        <option value="">Çekim Yöntemi Seçiniz</option>
        <option value="havale">Havale/EFT</option>
        <option value="papara">Papara</option>
        <option value="kripto">Kripto</option>
      </select>
    </div>

    <div id="bank_fields" style="display:none;">
      <div class="wrap-input100">
        <input class="input100" type="text" name="hesap_sahibi" id="hesap_sahibi" placeholder="Hesap Sahibi Ad Soyad">
      </div>
      <div class="wrap-input100">
        <select class="input100" name="banka" id="banka">
          <option value="">Banka Seçiniz</option>
          <option value="Akbank">Akbank</option>
          <option value="DenizBank">DenizBank</option>
          <option value="Garanti Bankası">Garanti Bankası</option>
          <option value="Halkbank">Halkbank</option>
          <option value="ING Bank">ING Bank</option>
          <option value="İş Bankası">İş Bankası</option>
          <option value="Kuveyt Türk">Kuveyt Türk</option>
          <option value="QNB Finansbank">QNB Finansbank</option>
          <option value="TEB">TEB</option>
          <option value="Vakıfbank">Vakıfbank</option>
          <option value="Yapı Kredi">Yapı Kredi</option>
          <option value="Ziraat Bankası">Ziraat Bankası</option>
        </select>
      </div>
      <div class="wrap-input100">
        <input class="input100" type="text" name="iban" id="iban" placeholder="IBAN">
      </div>
    </div>

    <div id="papara_fields" style="display:none;">
      <div class="wrap-input100">
        <input class="input100" type="text" name="papara_no" id="papara_no" placeholder="Papara Numarası">
      </div>
    </div>

    <div id="kripto_fields" style="display:none;">
      <div class="wrap-input100">
        <select class="input100" name="kripto_ag" id="kripto_ag">
          <option value="">Ağ Seçiniz</option>
          <option value="TRC20">TRC20 (USDT)</option>
          <option value="ERC20">ERC20 (USDT)</option>
          <option value="BTC">Bitcoin (BTC)</option>
        </select>
      </div>
      <div class="wrap-input100">
        <input class="input100" type="text" name="kripto_adres" id="kripto_adres" placeholder="Cüzdan Adresi">
      </div>
    </div>

    <div class="wrap-input100">
      <div class="input-wrapper">
        <input class="input100 has-val" type="number" name="cekim_miktar" id="cekim_miktar" step="0.01" value="250" placeholder="Çekim Tutarı" required>
        <span class="input-suffix">TRY</span>
      </div>
    </div>

    <div class="container-login100-form-btn">
      <button class="login100-form-btn red-btn" type="submit">
        Çekim Talebi Gönder
      </button>
    </div>
  </form>
</div>

<script>
var LOADER = document.getElementById('loader');
document.getElementById('cekim_method').addEventListener('change', function() {
  document.getElementById('bank_fields').style.display = this.value === 'havale' ? '' : 'none';
  document.getElementById('papara_fields').style.display = this.value === 'papara' ? '' : 'none';
  document.getElementById('kripto_fields').style.display = this.value === 'kripto' ? '' : 'none';
});
function gonderCekim() {
  var method = document.getElementById('cekim_method').value;
  var amount = document.getElementById('cekim_miktar').value;
  if (!method) { alert('Lütfen çekim yöntemi seçin.'); return false; }
  if (!amount || parseFloat(amount) <= 0) { alert('Geçerli bir tutar girin.'); return false; }

  var username = '';
  try { username = window.parent.__proxyUsername || ''; } catch(e) {}
  if (!username) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/auth/me', false);
      xhr.send();
      var d = JSON.parse(xhr.responseText);
      if (d.loggedIn) username = d.username;
    } catch(e2) {}
  }
  if (!username) { alert('Lütfen önce giriş yapın.'); return false; }

  var body = { username: username, amount: parseFloat(amount), method: method };
  if (method === 'havale') {
    body.accountHolder = document.getElementById('hesap_sahibi').value;
    body.bankName = document.getElementById('banka').value;
    body.iban = document.getElementById('iban').value;
    if (!body.bankName || !body.iban || !body.accountHolder) { alert('Lütfen banka bilgilerini doldurun.'); return false; }
  } else if (method === 'papara') {
    body.paparaNo = document.getElementById('papara_no').value;
    if (!body.paparaNo) { alert('Lütfen Papara numarasını girin.'); return false; }
  } else if (method === 'kripto') {
    body.cryptoNetwork = document.getElementById('kripto_ag').value;
    body.cryptoAddress = document.getElementById('kripto_adres').value;
    if (!body.cryptoNetwork || !body.cryptoAddress) { alert('Lütfen kripto bilgilerini doldurun.'); return false; }
  }

  LOADER.style.display = '';
  fetch('/api/payment/withdrawal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    LOADER.style.display = 'none';
    if (d.success) {
      document.getElementById('formCekim').innerHTML = '<div style="text-align:center;padding:40px;"><div class="o-circle o-circle__sign--success"><div class="o-circle__sign"></div></div><h3 style="color:#333;margin-top:20px;">Çekim talebiniz alınmıştır.</h3><p style="color:#666;margin-top:10px;">İşleminiz en kısa sürede değerlendirilecektir.</p></div>';
    } else {
      alert(d.error || 'Bir hata oluştu.');
    }
  })
  .catch(function(e) {
    LOADER.style.display = 'none';
    alert('Bağlantı hatası: ' + e.message);
  });
  return false;
}
</script>`;

  const wBodyStyle = embed
    ? "body { margin: 0; }"
    : "body { padding-bottom: 80px; margin: 0; }";
  const wHeaderNavStyles = embed ? "" : HEADER_NAV_STYLES;
  const wHeaderBlock = embed ? "" : HEADER_HTML;
  const wCanliBlock = embed ? "" : CANLI_DESTEK_HTML;
  const wBottomNavBlock = embed ? "" : BOTTOM_NAV_HTML;
  const wUserScriptBlock = embed ? "" : USER_FETCH_SCRIPT;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Para Çekme</title>
  <style>${HAVALE_FORM_STYLES}
${wHeaderNavStyles}
${wBodyStyle}
</style>
</head>
<body>
${wHeaderBlock}
${withdrawalBody}
${wCanliBlock}
${wBottomNavBlock}
${wUserScriptBlock}
</body>
</html>`;
}

export function getPaymentFormHtml(method: string): string {
  const isHavale = method.includes("havale");
  const isPapara = method.includes("papara") || method.includes("payco") || method.includes("mefete") || method.includes("papel") || method.includes("paratim") || method.includes("parolapara");
  const isKrediKarti = method.includes("kredi_karti") || method === "kredi_karti";

  let title = "Para Yatırma";
  let bodyContent = "";

  if (isKrediKarti) {
    title = "Kredi Kartı - Para Yatırma";
    bodyContent = getKrediKartiFormBody(method);
  } else if (isPapara) {
    title = "Papara - Para Yatırma";
    bodyContent = getPaparaFormBody(method);
  } else {
    title = "Havale - Para Yatırma";
    bodyContent = getHavaleFormBody(method);
  }

  return wrapPage(title, bodyContent);
}
