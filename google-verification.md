This is a Google Cloud Console configuration change, not a code change. You need to publish your OAuth    
  consent screen from "Testing" to "Production" mode.                                                       
                                                                                                            
  Steps to Publish Your App                                                                                 
                                                                                                            
  1. Go to https://console.cloud.google.com/                                                                
  2. Select your project                                                                                    
  3. Navigate to APIs & Services → OAuth consent screen                                                     
  4. Under "Publishing status", click PUBLISH APP                                                           
  5. Confirm the dialog                                                                                     
                                                                                                            
  Important Considerations                                                                                  
  ┌───────────────────────┬─────────────────────────────────────┬──────────────────────┐                    
  │        Status         │           Who can sign in           │ Verification needed? │                    
  ├───────────────────────┼─────────────────────────────────────┼──────────────────────┤                    
  │ Testing               │ Only test users (max 100)           │ No                   │                    
  ├───────────────────────┼─────────────────────────────────────┼──────────────────────┤                    
  │ Production (internal) │ Anyone in your Google Workspace org │ No                   │                    
  ├───────────────────────┼─────────────────────────────────────┼──────────────────────┤                    
  │ Production (external) │ Anyone with a Google account        │ Depends on scopes    │                    
  └───────────────────────┴─────────────────────────────────────┴──────────────────────┘                    
  If using sensitive scopes (like Gmail API)                                                                
                                                                                                            
  Google may require verification before publishing. Your app uses Gmail scopes which are considered        
  sensitive/restricted. You'll likely need to:                                                              
                                                                                                            
  1. Submit for verification                                                                                
  2. Provide a privacy policy URL                                                                           
  3. Explain why you need the scopes                                                                        
  4. Possibly undergo a security assessment (for restricted scopes)                                         
                                                                                                            
  Workaround for testing with more users                                                                    
                                                                                                            
  If you just need more test users temporarily while awaiting verification:                                 
  - You can add up to 100 test users in the OAuth consent screen                                            
                                                                                                            
  Would you like guidance on the verification process, or is your app using Workspace internal users only?