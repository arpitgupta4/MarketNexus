import yfinance as yf
import pandas as pd
import os
import time
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from datetime import datetime
import random

# Thread-local storage for yf.Ticker objects to prevent memory leaks
thread_local = threading.local()

def get_ticker(symbol):
    """Get or create a thread-local ticker object."""
    if not hasattr(thread_local, 'tickers'):
        thread_local.tickers = {}
    
    if symbol not in thread_local.tickers:
        thread_local.tickers[symbol] = yf.Ticker(symbol)
    
    return thread_local.tickers[symbol]

def fetch_indian_stock(row):
    """Fetch business summary and market cap for Indian stocks."""
    index, data = row
    symbol = str(data['Security Id']).strip()
    
    # Skip if already enriched (Smart Resume)
    if (pd.notna(data.get('Business_Summary')) and 
        str(data.get('Business_Summary')).strip() not in ["N/A", "", "nan"]):
        return index, "SKIPPED", None
    
    # 🧠 Smart Routing: If it's a 6-digit number, it's a BSE Scrip Code
    if symbol.isdigit():
        exchanges = [f"{symbol}.BO"]
    else:
        exchanges = [f"{symbol}.NS", f"{symbol}.BO"]
    
    for exchange in exchanges:
        try:
            ticker = get_ticker(exchange)
            info = ticker.info
            
            # Check if we got valid data (Relaxed the strict summary check)
            if info and len(info) > 5:
                # Fallback: If long summary is missing, grab the industry or sector
                summary = info.get("longBusinessSummary")
                if not summary:
                    summary = info.get("industry", info.get("sector", "Summary not available on Yahoo Finance"))
                
                mcap = info.get("marketCap", "N/A")
                
                # As long as we got some useful data, save it instead of failing
                if summary != "Summary not available on Yahoo Finance" or mcap != "N/A":
                    return index, "SUCCESS", {
                        'Business_Summary': summary,
                        'Market_Cap': mcap,
                        'Exchange': exchange.split('.')[-1]
                    }
        except Exception:
            continue
    
    return index, "FAILED", None
def enrich_indian_stocks(input_csv_path, output_csv_path):
    """Multithreaded enricher for Indian stocks."""
    
    print("🚀 MarketNexus Stock Enricher (Master Version)")
    print("="*60)
    
    # Ensure directories exist
    os.makedirs(os.path.dirname(output_csv_path), exist_ok=True)
    
    # Smart Load: Check if we have an existing save file to resume
    if os.path.exists(output_csv_path):
        print(f"📂 Found existing progress! Loading from {output_csv_path} to resume...")
        df = pd.read_csv(output_csv_path)
        already_enriched = df[df['Business_Summary'].notna() & (df['Business_Summary'] != 'N/A')].shape[0]
        print(f"   Loaded {len(df)} stocks, {already_enriched} already enriched")
    else:
        print(f"🆕 Starting fresh. Loading raw universe from {input_csv_path}...")
        try:
            df = pd.read_csv(input_csv_path)
        except FileNotFoundError:
            print(f"❌ [ERROR] Could not find {input_csv_path}")
            return

    # Add necessary columns if they don't exist
    if 'Business_Summary' not in df.columns:
        df['Business_Summary'] = "N/A"
    if 'Market_Cap' not in df.columns:
        df['Market_Cap'] = "N/A"
    if 'Exchange' not in df.columns:
        df['Exchange'] = "N/A"

    # Count how many actually need processing
    to_process = df[df['Business_Summary'].isna() | (df['Business_Summary'] == 'N/A')].shape[0]
    
    if to_process == 0:
        print("✅ All stocks already enriched! Nothing to do.")
        return
    
    print(f"📊 Need to enrich: {to_process} stocks out of {len(df)} total")
    
    # Filter only the rows that need processing
    rows_to_process = []
    for i, row in df.iterrows():
        if pd.isna(row.get('Business_Summary')) or str(row.get('Business_Summary')).strip() in ['N/A', '', 'nan']:
            rows_to_process.append((i, row))
    
    print(f"🚀 Firing up 8 threads to process {len(rows_to_process)} stocks...")
    print(f"⏱️  Estimated time: ~{len(rows_to_process) * 0.15 / 60:.1f} minutes\n")

    # Statistics & Checkpoints
    success_count = 0
    fail_count = 0
    save_counter = 0
    start_time = time.time()

    # Progress tracking UI
    pbar = tqdm(total=len(rows_to_process), desc="Fetching Data", unit="stock")

    # The Multithreaded Engine
    with ThreadPoolExecutor(max_workers=8) as executor:
        # Submit all jobs to the thread pool
        future_to_row = {executor.submit(fetch_indian_stock, row): row for row in rows_to_process}
        
        # Process them asynchronously as they complete
        for future in as_completed(future_to_row):
            index, status, data = future.result()
            
            if status == "SKIPPED":
                pbar.set_postfix({"status": "⏭️ skipped"}, refresh=False)
                
            elif status == "SUCCESS" and data:
                # Update the main dataframe
                df.at[index, 'Business_Summary'] = data['Business_Summary']
                df.at[index, 'Market_Cap'] = data['Market_Cap']
                df.at[index, 'Exchange'] = data['Exchange']
                
                success_count += 1
                
                # Show live updates on the progress bar
                pbar.set_postfix({
                    'success': success_count,
                    'failed': fail_count,
                    'latest': df.at[index, 'Security Id']
                }, refresh=False)
                
                # Auto-Save Checkpoint every 25 successful fetches
                if success_count % 25 == 0:
                    df.to_csv(output_csv_path, index=False)
                    save_counter += 1
                    pbar.set_postfix({'saved': f'💾 checkpoint #{save_counter}'}, refresh=False)
            else:
                fail_count += 1
                pbar.set_postfix({
                    'success': success_count,
                    'failed': fail_count
                }, refresh=False)
            
            pbar.update(1)
            
            # Micro-sleep to avoid triggering Yahoo's anti-bot blocks
            time.sleep(random.uniform(0.05, 0.1))

    pbar.close()

    # Final definitive save
    df.to_csv(output_csv_path, index=False)
    
    # Post-Run Analytics
    elapsed_time = time.time() - start_time
    minutes = int(elapsed_time // 60)
    seconds = int(elapsed_time % 60)
    
    print(f"\n{'='*60}")
    print(f"✅ ENRICHMENT COMPLETE!")
    print(f"{'='*60}")
    print(f"📁 Output: {output_csv_path}")
    print(f"⏱️  Time taken: {minutes}m {seconds}s")
    print(f"📊 Statistics:")
    print(f"   • Total stocks: {len(df)}")
    print(f"   • Successfully enriched: {success_count}")
    print(f"   • Failed: {fail_count}")
    
    if (success_count + fail_count) > 0:
        print(f"   • Success rate: {success_count/(success_count+fail_count)*100:.1f}%")
        
    print(f"   • Checkpoints saved: {save_counter}")
    
    # Show exchange distribution
    if 'Exchange' in df.columns:
        exchange_counts = df[df['Exchange'] != 'N/A']['Exchange'].value_counts()
        if len(exchange_counts) > 0:
            print(f"\n📈 Exchange distribution:")
            for exchange, count in exchange_counts.items():
                exchange_name = "NSE" if exchange == "NS" else "BSE"
                print(f"   • {exchange_name}: {count} stocks")

# --- Execution ---
if __name__ == "__main__":
    # Ensure these paths perfectly match your local folder structure
    INPUT_PATH = "/Users/arpit/Desktop/MarketNexus/archive/sector_data.csv"
    OUTPUT_PATH = "/Users/arpit/Desktop/MarketNexus/archive/marketnexus_enriched.csv"
    
    enrich_indian_stocks(INPUT_PATH, OUTPUT_PATH)